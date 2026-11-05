"""NutriShield child nutrition screening and monitoring backend."""

from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime
from functools import lru_cache
from io import BytesIO, StringIO
import csv
import json
import logging
import math
import os
import sqlite3
import zipfile

import joblib
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

import storage

logger = logging.getLogger(__name__)

# Trained machine learning pipeline state
model_load_error = None
loaded_pipeline = None
scaler_mean = None
scaler_scale = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Verify or reload ML model safely during application lifespan."""
    storage.initialize_database()
    if loaded_pipeline is None:
        load_ml_model()
    yield


# Initialize FastAPI app with production settings (debug=False)
app = FastAPI(
    title="NutriShield – AI-Powered Child Nutrition Screening and Monitoring System",
    description="Supporting child nutrition awareness through data-driven analysis.",
    version="2.1.0",
    lifespan=lifespan,
    debug=False,
)


@app.middleware("http")
async def add_privacy_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


# Allowed origins: include common local development servers (e.g. VS Code Live Server, Vite, Next.js)
DEFAULT_DEV_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5504",
    "http://localhost:5504",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]
env_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("NUTRISHIELD_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
ALL_CORS_ORIGINS = list(dict.fromkeys(DEFAULT_DEV_ORIGINS + env_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALL_CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Define file paths
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "new_svm_with_grid_search.joblib"
DATASET_PATH = BASE_DIR / "Malnutrition data.csv"
STATIC_DIR = BASE_DIR / "static"
BATCH_FEATURES = ["Sex", "Age", "Height", "Weight"]
MAX_BATCH_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_BATCH_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_BATCH_ROWS = 10000
MIN_SCREENING_AGE = 1
MAX_SCREENING_AGE = 21
OBSERVED_DATASET_AGE_MIN = 1
OBSERVED_DATASET_AGE_MAX = 5
UNSUPPORTED_AGE_WARNING = (
    "Ages 6–21 are outside the observed dataset and saved model support-vector range of 1–5. "
    "Predictions in this age range are unvalidated model extrapolations."
)

# Trained machine learning pipeline state
model_load_error = None
loaded_pipeline = None
scaler_mean = None
scaler_scale = None


def load_ml_model(model_path: Path = MODEL_PATH):
    """
    Safely loads the trained machine learning pipeline from disk into memory.
    Validates model file existence, non-emptiness, and pipeline structure.
    Ensures model is loaded once and not repeatedly per prediction.
    """
    global loaded_pipeline, model_load_error, scaler_mean, scaler_scale

    loaded_pipeline = None
    scaler_mean = None
    scaler_scale = None
    model_load_error = None

    if not model_path.exists():
        model_load_error = f"Model file not found at {model_path.name}"
        return None

    if not model_path.is_file():
        model_load_error = f"Model path {model_path.name} is not a regular file"
        return None

    try:
        if model_path.stat().st_size == 0:
            model_load_error = f"Model file {model_path.name} is empty (0 bytes)"
            return None

        pipeline = joblib.load(model_path)

        if not hasattr(pipeline, "predict") or not callable(pipeline.predict):
            model_load_error = "Loaded model artifact lacks a callable 'predict' method"
            return None

        if hasattr(pipeline, "named_steps") and "standardscaler" in pipeline.named_steps:
            scaler = pipeline.named_steps["standardscaler"]
            if hasattr(scaler, "mean_") and hasattr(scaler, "scale_"):
                scaler_mean = [round(float(v), 4) for v in scaler.mean_]
                scaler_scale = [round(float(v), 4) for v in scaler.scale_]

        loaded_pipeline = pipeline
        model_load_error = None
        return loaded_pipeline
    except Exception as e:
        loaded_pipeline = None
        model_load_error = f"Failed to load ML model: {e}"
        return None


# Load model at import time for immediate availability
load_ml_model()



class PredictionInput(BaseModel):
    """Pydantic schema for JSON-based predictions"""
    Sex: str = Field(..., description="'male' or 'female'")
    Age: int = Field(
        ...,
        description="Age in completed years, from 1 to 21 inclusive. Ages 6–21 are outside the observed dataset/model range.",
    )
    Height: float = Field(..., gt=20, le=250, description="Height in centimetres")
    Weight: float = Field(..., gt=1, le=150, description="Weight in kilograms")

    @field_validator("Age")
    @classmethod
    def validate_age_range(cls, age: int) -> int:
        if not MIN_SCREENING_AGE <= age <= MAX_SCREENING_AGE:
            raise ValueError("Age must be between 1 and 21 years, inclusive.")
        return age


class ScreeningSaveInput(PredictionInput):
    child_code: str | None = Field(default=None, max_length=64)


def compute_bmi(height_cm: float, weight_kg: float) -> float:
    """Computes Body Mass Index (BMI = kg / m^2)"""
    if height_cm <= 0:
        return 0.0
    height_m = height_cm / 100.0
    return round(weight_kg / (height_m ** 2), 2)


def compute_model_sensitivity(input_df: pd.DataFrame, prediction: str) -> dict:
    """Measure one-feature-at-a-time label changes around this input for the fitted SVM."""
    if loaded_pipeline is None or not hasattr(loaded_pipeline, "named_steps"):
        return {"available": False, "features": [], "changed_features": []}

    scaler = loaded_pipeline.named_steps.get("standardscaler")
    if scaler is None or not hasattr(scaler, "scale_"):
        return {"available": False, "features": [], "changed_features": []}

    feature_names = list(input_df.columns)
    if len(feature_names) != len(scaler.scale_):
        return {"available": False, "features": [], "changed_features": []}

    features = []
    for index, feature in enumerate(feature_names):
        original_value = input_df.iloc[0][feature]
        if feature == "Sex":
            alternatives = [(0 if int(original_value) == 1 else 1, "Female" if int(original_value) == 1 else "Male")]
        else:
            step = max(1, round(float(scaler.scale_[index]))) if feature == "Age" else float(scaler.scale_[index])
            lower_bound, upper_bound = {
                "Age": (MIN_SCREENING_AGE, MAX_SCREENING_AGE),
                "Height": (20.1, 250),
                "Weight": (1.1, 150),
            }[feature]
            candidates = {
                max(lower_bound, min(upper_bound, float(original_value) - step)),
                max(lower_bound, min(upper_bound, float(original_value) + step)),
            }
            alternatives = [
                (int(value) if feature == "Age" else round(value, 2), str(int(value)) if feature == "Age" else str(round(value, 2)))
                for value in sorted(candidates)
                if value != float(original_value)
            ]

        variants = []
        for value, display_value in alternatives:
            changed_input = input_df.copy()
            changed_input.loc[0, feature] = value
            variant_prediction = str(loaded_pipeline.predict(changed_input)[0])
            variants.append({
                "value": display_value,
                "prediction": variant_prediction,
                "changed_prediction": variant_prediction != prediction,
            })

        features.append({
            "feature": feature,
            "input_value": str(original_value),
            "variants": variants,
            "changed_prediction": any(item["changed_prediction"] for item in variants),
        })

    return {
        "available": True,
        "method": "one_feature_at_a_time",
        "features": features,
        "changed_features": [item["feature"] for item in features if item["changed_prediction"]],
        "note_en": (
            "Each feature was varied individually (sex switched; numeric values shifted by about one "
            "fitted scaler standard deviation). This measures local model sensitivity, not medical "
            "causation or a clinical explanation."
        ),
    }


def run_model_inference(sex_val: str, age_val: int, height_val: float, weight_val: float) -> dict:
    """Executes the loaded scikit-learn pipeline and builds explainability metadata"""
    if not MIN_SCREENING_AGE <= age_val <= MAX_SCREENING_AGE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Age must be between 1 and 21 years, inclusive.",
        )
    if loaded_pipeline is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Machine learning model is not available: {model_load_error or 'Not loaded'}"
        )

    # Encode Sex (1 = male, 0 = female) as used during model training
    normalized_sex = sex_val.strip().lower()
    if normalized_sex == "male":
        sex_code = 1
    elif normalized_sex == "female":
        sex_code = 0
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid input for Sex. Use 'male' or 'female'."
        )

    # Prepare DataFrame matching training feature names exactly: ['Sex', 'Age', 'Height', 'Weight']
    input_data = {
        "Sex": sex_code,
        "Age": age_val,
        "Height": float(height_val),
        "Weight": float(weight_val),
    }
    input_df = pd.DataFrame([input_data])[["Sex", "Age", "Height", "Weight"]]

    # Generate prediction from real trained model
    prediction = str(loaded_pipeline.predict(input_df)[0])
    calculated_bmi = compute_bmi(height_val, weight_val)
    explainability = compute_model_sensitivity(input_df, prediction)

    age_within_observed_range = OBSERVED_DATASET_AGE_MIN <= age_val <= OBSERVED_DATASET_AGE_MAX
    age_range_warning = None if age_within_observed_range else UNSUPPORTED_AGE_WARNING
    disclaimer = (
        "This result represents a machine learning prediction based on the available dataset. "
        "It is not a confirmed medical diagnosis."
    )
    if age_range_warning:
        disclaimer = f"{disclaimer} {age_range_warning}"

    return {
        "Detected as": prediction,
        "status": "success",
        "Sex": normalized_sex.capitalize(),
        "Age": age_val,
        "Height": height_val,
        "Weight": weight_val,
        "inputs": {
            "Sex": normalized_sex.capitalize(),
            "Age": age_val,
            "Height": height_val,
            "Weight": weight_val,
        },
        "bmi": calculated_bmi,
        "explainability": explainability,
        "timestamp": datetime.now().astimezone().isoformat(),
        "disclaimer": disclaimer,
        "age_within_observed_range": age_within_observed_range,
        "age_range_warning": age_range_warning,
        "child_specificity_verified": False,
        "clinical_validation_verified": False,
    }


# ============================================================================
# API Routes
# ============================================================================

def _read_source_dataset():
    if not DATASET_PATH.is_file():
        return None, "dataset_file_missing", f"Dataset file not found: {DATASET_PATH.name}."

    try:
        try:
            dataset = pd.read_csv(DATASET_PATH, encoding="utf-8-sig")
        except UnicodeDecodeError:
            dataset = pd.read_csv(DATASET_PATH, encoding="latin-1")
    except (OSError, pd.errors.ParserError, UnicodeDecodeError, ValueError) as error:
        return None, "dataset_read_error", f"Dataset could not be read: {error}"

    dataset.columns = dataset.columns.astype(str).str.strip()
    if "Status" not in dataset.columns:
        return None, "target_column_missing", "Dataset is missing the required Status target column."
    return dataset, None, None


def _build_dataset_summary():
    dataset, reason_code, reason = _read_source_dataset()
    if dataset is None:
        return {
            "available": False,
            "reason_code": reason_code,
            "reason": reason,
            "dataset_path": DATASET_PATH.name,
            "target_column": "Status",
            "total_rows": None,
            "labeled_rows": None,
            "missing_target_rows": None,
            "class_counts": None,
        }

    labels = dataset["Status"].astype("string").str.strip().dropna()
    labels = labels[labels != ""]
    counts = labels.value_counts().sort_index()
    feature_columns = ["Sex", "Age", "Height", "Weight"]
    missing_features = [name for name in feature_columns if name not in dataset.columns]
    if missing_features:
        quality = {
            "duplicate_rows": int(dataset.duplicated().sum()),
            "duplicate_model_feature_label_rows": None,
            "duplicate_model_feature_rows": None,
            "feature_groups_with_conflicting_labels": None,
            "missing_values_by_column": {
                str(column): int(count)
                for column, count in dataset.isna().sum().items()
                if count
            },
            "invalid_model_feature_rows": None,
            "unsupported_target_labels": None,
            "missing_features": missing_features,
        }
    else:
        numeric = dataset[feature_columns].apply(pd.to_numeric, errors="coerce")
        valid_sex = numeric["Sex"].isin([0, 1])
        valid_age = numeric["Age"].between(1, 5) & numeric["Age"].mod(1).eq(0)
        valid_height = numeric["Height"].gt(20) & numeric["Height"].le(250)
        valid_weight = numeric["Weight"].gt(1) & numeric["Weight"].le(150)
        valid_features = numeric.notna().all(axis=1) & valid_sex & valid_age & valid_height & valid_weight
        allowed_labels = {"Stunting", "Wasting", "Underweight", "Overweight"}
        normalized_labels = dataset["Status"].astype("string").str.strip()
        quality = {
            "duplicate_rows": int(dataset.duplicated().sum()),
            "duplicate_model_feature_label_rows": int(
                dataset.duplicated(subset=feature_columns + ["Status"]).sum()
            ),
            "duplicate_model_feature_rows": int(dataset.duplicated(subset=feature_columns).sum()),
            "feature_groups_with_conflicting_labels": int(
                (
                    dataset.groupby(feature_columns, dropna=False)["Status"].nunique(dropna=False) > 1
                ).sum()
            ),
            "missing_values_by_column": {
                str(column): int(count)
                for column, count in dataset.isna().sum().items()
                if count
            },
            "invalid_model_feature_rows": int((~valid_features).sum()),
            "unsupported_target_labels": sorted({
                str(label)
                for label in normalized_labels.dropna().unique()
                if label and label not in allowed_labels
            }),
            "missing_features": [],
        }
    return {
        "available": True,
        "reason_code": None,
        "reason": None,
        "dataset_path": DATASET_PATH.name,
        "target_column": "Status",
        "total_rows": int(len(dataset)),
        "labeled_rows": int(len(labels)),
        "missing_target_rows": int(len(dataset) - len(labels)),
        "class_counts": {str(label): int(count) for label, count in counts.items()},
        "data_quality": quality,
    }


def _unavailable_performance(summary: dict, reason_code: str, reason: str) -> dict:
    return {
        "available": False,
        "evaluation_status": reason_code,
        "reason_code": reason_code,
        "reason": reason,
        "model_name": "Reconstructed SVC (separate from the saved deployment artifact)",
        "saved_artifact_metrics_available": False,
        "saved_artifact_reason": (
            "The saved joblib model has no verifiable split or test-prediction provenance."
        ),
        "dataset_available": summary["available"],
        "dataset_summary": summary,
        "target": summary["target_column"],
        "dataset_rows": summary["labeled_rows"],
        "class_counts": summary["class_counts"],
        "metrics": None,
        "class_metrics": None,
        "model_comparison": None,
        "roc_auc": None,
        "confusion_matrix": None,
        "classes": list(summary["class_counts"] or {}),
        "evaluation_methodology": None,
    }


@lru_cache(maxsize=2)
def _evaluate_reconstructed_model(dataset_mtime_ns: int, dataset_size: int) -> dict:
    del dataset_mtime_ns, dataset_size
    dataset, reason_code, reason = _read_source_dataset()
    summary = _build_dataset_summary()
    if dataset is None:
        return _unavailable_performance(summary, reason_code or "dataset_unavailable", reason or "Dataset unavailable.")

    features = ["Sex", "Age", "Height", "Weight"]
    missing_features = [feature for feature in features if feature not in dataset.columns]
    if missing_features:
        return _unavailable_performance(
            summary,
            "required_features_missing",
            f"Dataset is missing required model features: {', '.join(missing_features)}.",
        )

    numeric_features = dataset[features].apply(pd.to_numeric, errors="coerce")
    labels = dataset["Status"].astype("string").str.strip()
    valid_rows = numeric_features.notna().all(axis=1) & labels.notna() & labels.ne("")
    valid_frame = numeric_features.loc[valid_rows].copy()
    valid_frame["Status"] = labels.loc[valid_rows].astype(str)
    valid_frame = valid_frame.drop_duplicates(subset=features + ["Status"]).reset_index(drop=True)
    X = valid_frame[features]
    y = valid_frame["Status"]
    class_labels = sorted(y.unique().tolist())
    class_sizes = y.value_counts()

    if len(class_labels) < 2 or (not class_sizes.empty and int(class_sizes.min()) < 4):
        return _unavailable_performance(
            summary,
            "insufficient_labeled_samples",
            "The grouped holdout and training-only evaluation require at least four valid, de-duplicated records in each class.",
        )

    try:
        from imblearn.over_sampling import RandomOverSampler
        from imblearn.pipeline import Pipeline
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import (
            accuracy_score,
            confusion_matrix,
            f1_score,
            precision_recall_fscore_support,
            precision_score,
            recall_score,
        )
        from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold
        from sklearn.preprocessing import StandardScaler
        from sklearn.svm import SVC

        groups = pd.MultiIndex.from_frame(X).factorize()[0]
        outer_splitter = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=42)
        candidate_splits = list(outer_splitter.split(X, y, groups))
        viable_splits = [
            (train_indices, test_indices)
            for train_indices, test_indices in candidate_splits
            if set(y.iloc[test_indices]) == set(class_labels)
            and int(y.iloc[train_indices].value_counts().min()) >= 3
        ]
        if not viable_splits:
            return _unavailable_performance(
                summary,
                "grouped_split_unavailable",
                "The dataset cannot provide a grouped holdout with every class represented and enough training records for leakage-safe oversampling.",
            )
        train_indices, test_indices = min(
            viable_splits,
            key=lambda split: (abs(len(split[1]) / len(X) - 0.2), len(split[1])),
        )
        X_train, X_test = X.iloc[train_indices], X.iloc[test_indices]
        y_train, y_test = y.iloc[train_indices], y.iloc[test_indices]
        groups_train = groups[train_indices]
        pipeline = Pipeline([
            ("oversample", RandomOverSampler(random_state=42)),
            ("standardscaler", StandardScaler()),
            ("svc", SVC(random_state=42)),
        ])
        search = GridSearchCV(
            pipeline,
            {"svc__C": [0.1, 1, 10], "svc__kernel": ["linear", "poly", "rbf"]},
            cv=StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=42),
            scoring="f1_macro",
            n_jobs=1,
        )
        search.fit(X_train, y_train, groups=groups_train)
        predictions = search.predict(X_test)
        matrix = confusion_matrix(y_test, predictions, labels=class_labels)

        forest_pipeline = Pipeline([
            ("oversample", RandomOverSampler(random_state=42)),
            ("randomforest", RandomForestClassifier(random_state=42, n_jobs=1)),
        ])
        forest_search = GridSearchCV(
            forest_pipeline,
            {
                "randomforest__n_estimators": [200, 400],
                "randomforest__min_samples_leaf": [1, 2],
            },
            cv=StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=42),
            scoring="f1_macro",
            n_jobs=1,
        )
        forest_search.fit(X_train, y_train, groups=groups_train)
        forest_predictions = forest_search.predict(X_test)
    except ImportError as error:
        return _unavailable_performance(
            summary,
            "evaluation_dependency_unavailable",
            f"Reconstructed evaluation dependency is unavailable: {error}",
        )
    except Exception as error:
        return _unavailable_performance(
            summary,
            "evaluation_failed",
            f"Reconstructed holdout evaluation failed: {error}",
        )

    test_counts = y_test.value_counts().to_dict()
    rare_test_classes = {
        label: int(test_counts.get(label, 0))
        for label in class_labels
        if int(test_counts.get(label, 0)) < 5
    }
    class_precision, class_recall, class_f1, class_support = precision_recall_fscore_support(
        y_test,
        predictions,
        labels=class_labels,
        zero_division=0,
    )
    forest_metrics = {
        "accuracy": float(accuracy_score(y_test, forest_predictions)),
        "precision_macro": float(precision_score(
            y_test, forest_predictions, labels=class_labels, average="macro", zero_division=0
        )),
        "recall_macro": float(recall_score(
            y_test, forest_predictions, labels=class_labels, average="macro", zero_division=0
        )),
        "f1_macro": float(f1_score(
            y_test, forest_predictions, labels=class_labels, average="macro", zero_division=0
        )),
        "f1_weighted": float(f1_score(
            y_test, forest_predictions, labels=class_labels, average="weighted", zero_division=0
        )),
    }
    svc_metrics = {
        "accuracy": float(accuracy_score(y_test, predictions)),
        "precision_macro": float(precision_score(
            y_test, predictions, labels=class_labels, average="macro", zero_division=0
        )),
        "recall_macro": float(recall_score(
            y_test, predictions, labels=class_labels, average="macro", zero_division=0
        )),
        "f1_macro": float(f1_score(
            y_test, predictions, labels=class_labels, average="macro", zero_division=0
        )),
        "f1_weighted": float(f1_score(
            y_test, predictions, labels=class_labels, average="weighted", zero_division=0
        )),
    }
    candidate_metrics = {
        "reconstructed_svc": {
            **svc_metrics,
            "validation_macro_f1": float(search.best_score_),
            "selected_parameters": {key: value for key, value in search.best_params_.items()},
        },
        "reconstructed_random_forest": {
            **forest_metrics,
            "validation_macro_f1": float(forest_search.best_score_),
            "selected_parameters": {key: value for key, value in forest_search.best_params_.items()},
        },
    }
    best_candidate = max(
        candidate_metrics,
        key=lambda name: candidate_metrics[name]["validation_macro_f1"],
    )
    evaluation_time = datetime.now().astimezone().isoformat()
    return {
        "available": True,
        "evaluation_status": "reconstructed_holdout_evaluation",
        "evaluation_date": evaluation_time,
        "reason_code": None,
        "reason": (
            "These metrics compare reconstructed SVC and random-forest candidates, not the saved deployment artifact. "
            "The original artifact's training and test-split provenance remain unverified."
        ),
        "model_name": "Reconstructed SVC (not the saved deployment artifact)",
        "saved_artifact_metrics_available": False,
        "saved_artifact_reason": (
            "The saved joblib model has no verifiable split or test-prediction provenance."
        ),
        "dataset_available": True,
        "dataset_summary": summary,
        "target": "Status",
        "dataset_rows": int(len(y)),
        "source_dataset_rows": summary["labeled_rows"],
        "class_counts": summary["class_counts"],
        "metrics": {
            **svc_metrics,
        },
        "class_metrics": {
            label: {
                "precision": float(class_precision[index]),
                "recall": float(class_recall[index]),
                "f1": float(class_f1[index]),
                "support": int(class_support[index]),
            }
            for index, label in enumerate(class_labels)
        },
        "model_comparison": {
            "candidates": candidate_metrics,
            "selection_metric": "training-only grouped cross-validated macro F1-score",
            "best_candidate": best_candidate,
            "deployed_model": "saved new_svm_with_grid_search.joblib",
            "deployed_model_changed": False,
            "note": (
                "Both candidates were tuned on the training partition using grouped cross-validation and compared on the same held-out split. "
                "The saved deployment artifact was not replaced because its training provenance is unverified."
            ),
        },
        "roc_auc": {
            "available": False,
            "reason": (
                "ROC-AUC is omitted because the stratified test split contains too few Wasting examples "
                "for a stable one-vs-rest estimate."
            ),
        },
        "confusion_matrix": matrix.astype(int).tolist(),
        "classes": class_labels,
        "test_class_counts": {label: int(test_counts.get(label, 0)) for label in class_labels},
        "evaluation_methodology": {
            "evaluation_date": evaluation_time,
            "dataset_split": (
                "Deterministic stratified-group holdout (approximately 75/25); exact duplicate "
                "feature/label rows removed before splitting, and identical feature tuples kept in one group"
            ),
            "random_seed": 42,
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "cross_validation": "Three-fold stratified-group CV on training data only; the held-out groups are not used in tuning",
            "grouping_unit": "Exact Sex/Age/Height/Weight feature tuple; the source has no child identifier for child-level grouping",
            "duplicate_model_feature_label_rows_removed": int(
                summary["data_quality"]["duplicate_model_feature_label_rows"]
            ),
            "training_pipeline": "Training-only random oversampling -> StandardScaler -> macro-F1 SVC search; random forest is evaluated separately",
            "best_parameters": {key: value for key, value in search.best_params_.items()},
            "class_label_order": class_labels,
            "rare_test_classes": rare_test_classes,
            "limitations": (
                "Only one Wasting record appears in this test split, so class-specific performance "
                "for Wasting is highly unstable. The source labels and child-specific provenance "
                "are not clinically verified."
            ) if rare_test_classes else "Dataset source and clinical label validity are unverified.",
        },
    }


def get_dataset_summary() -> dict:
    return _build_dataset_summary()


def get_model_performance() -> dict:
    summary = _build_dataset_summary()
    if not summary["available"]:
        return _unavailable_performance(
            summary,
            summary["reason_code"] or "dataset_unavailable",
            summary["reason"] or "Dataset unavailable.",
        )

    try:
        stat = DATASET_PATH.stat()
        return _evaluate_reconstructed_model(stat.st_mtime_ns, stat.st_size)
    except OSError as error:
        return _unavailable_performance(
            summary,
            "dataset_stat_error",
            f"Dataset file could not be accessed: {error}",
        )


def get_model_metrics() -> dict:
    """Backward-compatible name for the structured model-performance response."""
    return get_model_performance()


def _pdf_text(value: str) -> str:
    """Escape a plain-text value for a built-in Helvetica PDF text operator."""
    safe_value = value.encode("ascii", "replace").decode("ascii")
    return safe_value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_screening_pdf(result: dict) -> bytes:
    """Create a small, dependency-free one-page PDF screening report."""
    inputs = result["inputs"]
    screening_date = datetime.fromisoformat(result["timestamp"]).strftime("%Y-%m-%d %H:%M %Z")
    lines = [
        ("NutriShield", 16, True),
        ("AI-Powered Child Nutrition Screening and Monitoring System", 10, False),
        ("Smarter Screening. Healthier Futures.", 12, True),
        (f"Screening date: {screening_date}", 11, False),
        ("", 10, False),
        (f"Predicted nutritional classification: {result['Detected as']}", 13, True),
        ("", 10, False),
        (f"Sex: {inputs['Sex']}", 11, False),
        (f"Age: {inputs['Age']} years", 11, False),
        (f"Height: {inputs['Height']} cm", 11, False),
        (f"Weight: {inputs['Weight']} kg", 11, False),
        (f"Calculated BMI: {result['bmi']} kg/m2 (raw value only)", 11, False),
        ("", 10, False),
        ("General next steps", 13, True),
        ("Discuss health or growth concerns with a qualified healthcare professional.", 10, False),
        ("Confirm measurements and ask about age- and sex-appropriate growth assessment.", 10, False),
        ("", 10, False),
        ("This result represents a machine learning prediction based on the available dataset.", 9, True),
        ("It is not a confirmed medical diagnosis.", 9, False),
        ("BMI is shown as a raw calculation only; no pediatric percentile or category is applied.", 9, False),
    ]
    if not result.get("age_within_observed_range", True):
        lines.extend([
            ("Age range warning: dataset and model support-vector ages are 1-5 years only.", 9, True),
            ("This age 6-21 prediction is an unvalidated model extrapolation.", 9, False),
        ])

    stream_lines = []
    y = 750
    for text, font_size, bold in lines:
        if text:
            font_name = "F2" if bold else "F1"
            text_color = "0.14 0.34 0.65" if text.startswith("NutriShield:") else (
                "0.07 0.46 0.44" if text in {"Smarter Screening. Healthier Futures.", "General next steps"}
                else "0.12 0.16 0.22"
            )
            stream_lines.append(
                f"{text_color} rg BT /{font_name} {font_size} Tf 54 {y} Td ({_pdf_text(text)}) Tj ET"
            )
        y -= 32 if not text else (30 if font_size >= 13 else 23)

    stream = "\n".join(stream_lines).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{number} 0 obj\n".encode("ascii"))
        pdf.extend(body)
        pdf.extend(b"\nendobj\n")

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(pdf)


@app.get("/api/status")
def get_system_status():
    """Backward-compatible diagnostic status endpoint."""
    classes_list = []
    pipeline_steps = []
    is_ready = False

    if loaded_pipeline is not None:
        is_ready = True
        if hasattr(loaded_pipeline, "named_steps"):
            pipeline_steps = list(loaded_pipeline.named_steps.keys())
            final_step = loaded_pipeline.steps[-1][1]
            if hasattr(final_step, "classes_"):
                classes_list = [str(c) for c in final_step.classes_]
        elif hasattr(loaded_pipeline, "classes_"):
            classes_list = [str(c) for c in loaded_pipeline.classes_]

    return {
        "app": "NutriShield – AI-Powered Child Nutrition Screening and Monitoring System",
        "status": "online" if is_ready else "degraded",
        "model_loaded": is_ready,
        "dataset_available": DATASET_PATH.is_file(),
        "model_file": MODEL_PATH.name,
        "model_architecture": "Support Vector Classifier (Pipeline with StandardScaler and RBF Kernel)",
        "pipeline_steps": pipeline_steps,
        "scaler_parameters": {
            "mean": scaler_mean,
            "scale": scaler_scale,
            "feature_order": ["Sex", "Age", "Height", "Weight"]
        },
        "classes": classes_list if classes_list else ["Overweight", "Stunting", "Underweight", "Wasting"],
        "expected_features": ["Sex", "Age", "Height", "Weight"],
        "supported_language": "English",
        "child_specificity_verified": False,
        "clinical_validation_verified": False,
        "error": model_load_error,
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/health")
def dedicated_health_check():
    """
    Dedicated lightweight health-check endpoint.
    Checks whether the FastAPI application is responding and whether the ML model is loaded.
    Returns HTTP 200 when ready, or HTTP 503 when the model is unavailable.
    Keeps health check lightweight and does not trigger predictions or sensitive info leaks.
    """
    model_ready = (loaded_pipeline is not None) and (model_load_error is None)
    response_data = {
        "status": "online" if model_ready else "degraded",
        "api": "FastAPI",
        "model_loaded": model_ready,
    }
    status_code = status.HTTP_200_OK if model_ready else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=response_data)


@app.get("/api/health")
def health_check():
    """Report backend and required data/model dependencies with an honest HTTP status."""
    model_loaded = loaded_pipeline is not None
    dataset = get_dataset_summary()
    dataset_available = dataset["available"] is True
    dependencies_ready = model_loaded and dataset_available
    health = {
        "application_running": True,
        "backend_online": True,
        "status": "connected" if dependencies_ready else "degraded",
        "model_loaded": model_loaded,
        "model_file": MODEL_PATH.name,
        "model_error": model_load_error,
        "dataset_available": dataset_available,
        "dataset_reason": dataset["reason"],
        "dataset_summary": dataset,
        "timestamp": datetime.now().astimezone().isoformat(),
    }
    return JSONResponse(
        status_code=200 if dependencies_ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=health,
    )


@app.get("/api/dashboard-summary")
def dashboard_summary():
    counts = storage.get_screening_counts()
    counts["recent_screenings"] = storage.list_screenings()[:5]
    return counts


def _screening_values(payload: ScreeningSaveInput) -> dict:
    child_code = payload.child_code.strip() if payload.child_code else ""
    if child_code and not storage.CHILD_CODE_PATTERN.fullmatch(child_code):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Child code may contain only letters, numbers, dots, underscores, and hyphens; do not enter a name.",
        )
    result = run_model_inference(payload.Sex, payload.Age, payload.Height, payload.Weight)
    return {
        "child_code": child_code or None,
        "sex": result["Sex"],
        "age": result["Age"],
        "height": result["Height"],
        "weight": result["Weight"],
        "bmi": result["bmi"],
        "predicted_status": result["Detected as"],
        "model_version": MODEL_PATH.name,
        "explainability_json": json.dumps(result["explainability"], separators=(",", ":")),
        "screened_at": result["timestamp"],
    }


@app.get("/api/screenings")
def list_saved_screenings(
    search: str = "",
    status_filter: str | None = None,
):
    allowed_statuses = {"Stunting", "Wasting", "Underweight", "Overweight"}
    if status_filter and status_filter not in allowed_statuses:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported model class filter.")
    records = storage.list_screenings(search=search.strip(), predicted_status=status_filter)
    return {"records": records}

@app.post("/api/screenings", status_code=status.HTTP_201_CREATED)
def save_screening(payload: ScreeningSaveInput):
    record = storage.create_screening(_screening_values(payload))
    return {"success": True, "record": record}


@app.patch("/api/screenings/{record_id}")
def edit_screening(record_id: str, payload: ScreeningSaveInput):
    record = storage.update_screening(
        record_id,
        _screening_values(payload),
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screening record not found.")
    return {"success": True, "record": record}


@app.delete("/api/screenings/{record_id}")
def remove_screening(record_id: str):
    deleted = storage.delete_screening(record_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screening record not found.")
    return {"success": True}


@app.delete("/api/screenings")
def remove_all_screenings():
    deleted_count = storage.delete_all_screenings()
    return {"success": True, "deleted_count": deleted_count}


@app.get("/api/screenings/export.csv")
def export_screenings():
    records = storage.list_screenings()
    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["Record ID", "Child Code", "Date", "Sex", "Age", "Height cm", "Weight kg", "BMI", "Experimental Model Class", "Dataset/model age range", "Model Version"])
    for record in records:
        writer.writerow([
            record["id"],
            record["child_code"] or "",
            record["screened_at"],
            record["sex"],
            record["age"],
            record["height"],
            record["weight"],
            record["bmi"],
            record["predicted_status"],
            (
                "Within observed range (1-5 years)"
                if OBSERVED_DATASET_AGE_MIN <= record["age"] <= OBSERVED_DATASET_AGE_MAX
                else "Outside observed range (6-21 years): unvalidated extrapolation"
            ),
            record["model_version"],
        ])
    return Response(
        content=stream.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="nutrishield-screenings.csv"'},
    )


@app.get("/api/dataset-summary")
def dataset_summary_endpoint():
    summary = get_dataset_summary()
    return JSONResponse(
        status_code=200 if summary["available"] else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=summary,
    )


@app.get("/api/model-performance")
@app.get("/api/model-metrics", include_in_schema=False)
def model_performance_endpoint():
    performance = get_model_performance()
    dependency_failed = not performance["dataset_available"] or performance["reason_code"] in {
        "evaluation_dependency_unavailable",
        "evaluation_failed",
        "dataset_stat_error",
    }
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE if dependency_failed else status.HTTP_200_OK,
        content=performance,
    )


def _serialize_upload_cell(value):
    if value is None:
        return ""
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _parse_batch_sex(value):
    if value is None or pd.isna(value) or str(value).strip() == "":
        raise ValueError("Sex is missing.")
    text = str(value).strip().casefold()
    if text in {"male", "m"}:
        return 1, "Male"
    if text in {"female", "f"}:
        return 0, "Female"
    try:
        numeric_value = float(text)
    except ValueError as error:
        raise ValueError("Sex must be Male/Female or the model encoding 1/0.") from error
    if numeric_value == 1:
        return 1, "Male"
    if numeric_value == 0:
        return 0, "Female"
    raise ValueError("Sex must be Male/Female or the model encoding 1/0.")


def _parse_batch_number(value, field_name):
    if value is None or pd.isna(value) or str(value).strip() == "":
        raise ValueError(f"{field_name} is missing.")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field_name} must be numeric.") from error
    if not math.isfinite(number):
        raise ValueError(f"{field_name} must be a finite number.")
    return number


def _validate_batch_row(row):
    reasons = []
    feature_values = {}
    try:
        sex_code, normalized_sex = _parse_batch_sex(row.get("Sex"))
        feature_values["Sex"] = sex_code
    except ValueError as error:
        reasons.append(str(error))
        normalized_sex = None

    try:
        age_value = _parse_batch_number(row.get("Age"), "Age")
        if not age_value.is_integer():
            reasons.append("Age must be a whole number of completed years.")
        elif not MIN_SCREENING_AGE <= age_value <= MAX_SCREENING_AGE:
            reasons.append("Age must be between 1 and 21 years, inclusive.")
        else:
            feature_values["Age"] = int(age_value)
    except ValueError as error:
        reasons.append(str(error))

    for field_name, minimum, maximum in (("Height", 20, 250), ("Weight", 1, 150)):
        try:
            number = _parse_batch_number(row.get(field_name), field_name)
            if not minimum < number <= maximum:
                units = "cm" if field_name == "Height" else "kg"
                reasons.append(f"{field_name} must be greater than {minimum} {units} and no more than {maximum} {units}.")
            else:
                feature_values[field_name] = number
        except ValueError as error:
            reasons.append(str(error))

    if reasons:
        return None, None, reasons
    feature_values["SexLabel"] = normalized_sex
    return feature_values, normalized_sex, []


def _read_batch_dataframe(filename: str, file_bytes: bytes):
    extension = Path(filename).suffix.casefold()
    if extension not in {".csv", ".xlsx"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload a .csv or .xlsx file.",
        )
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty.")

    try:
        if extension == ".csv":
            try:
                frame = pd.read_csv(BytesIO(file_bytes), dtype=str, keep_default_na=False, encoding="utf-8-sig")
            except UnicodeDecodeError:
                frame = pd.read_csv(BytesIO(file_bytes), dtype=str, keep_default_na=False, encoding="latin-1")
        else:
            workbook_stream = BytesIO(file_bytes)
            if not zipfile.is_zipfile(workbook_stream):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded XLSX file is not a valid Excel workbook.")
            workbook_stream.seek(0)
            with zipfile.ZipFile(workbook_stream) as workbook:
                workbook_files = workbook.namelist()
                uncompressed_size = sum(entry.file_size for entry in workbook.infolist())
            if "[Content_Types].xml" not in workbook_files or "xl/workbook.xml" not in workbook_files:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded XLSX file is missing required workbook data.")
            if uncompressed_size > MAX_BATCH_XLSX_UNCOMPRESSED_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The XLSX workbook expands beyond the 50 MB processing limit.")
            workbook_stream.seek(0)
            frame = pd.read_excel(workbook_stream, dtype=object, engine="openpyxl")
    except HTTPException:
        raise
    except (pd.errors.EmptyDataError, pd.errors.ParserError, UnicodeDecodeError, ValueError, OSError, zipfile.BadZipFile, ImportError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The uploaded {extension[1:].upper()} file could not be read: {error}",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The uploaded {extension[1:].upper()} file could not be read.",
        ) from error

    if frame.empty or len(frame.columns) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file has no records or columns.")
    if len(frame) > MAX_BATCH_ROWS:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The upload exceeds the {MAX_BATCH_ROWS:,}-row limit.",
        )

    frame.columns = [str(column).strip() for column in frame.columns]
    if len(set(frame.columns)) != len(frame.columns):
        raise HTTPException(status_code=422, detail="The file contains duplicate column names.")
    missing_columns = [column for column in BATCH_FEATURES if column not in frame.columns]
    if missing_columns:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required columns: {', '.join(missing_columns)}. Required columns: {', '.join(BATCH_FEATURES)}.",
        )
    return frame


@app.get("/api/batch-template")
def batch_template():
    template = ",".join(BATCH_FEATURES) + "\n"
    return Response(
        content=template,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="nutrishield-batch-template.csv"'},
    )


@app.post("/api/batch-predict")
async def batch_predict(upload: UploadFile = File(...)):
    if loaded_pipeline is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Saved model unavailable: {model_load_error or 'model could not be loaded'}.",
        )

    filename = upload.filename or ""
    if Path(filename).suffix.casefold() not in {".csv", ".xlsx"}:
        await upload.close()
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Upload a .csv or .xlsx file.")

    try:
        file_bytes = await upload.read(MAX_BATCH_UPLOAD_BYTES + 1)
    finally:
        await upload.close()
    if len(file_bytes) > MAX_BATCH_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="The upload exceeds the 10 MB file-size limit.",
        )

    frame = _read_batch_dataframe(filename, file_bytes)
    valid_feature_rows = []
    valid_row_details = []
    rejected_rows = []
    seen_feature_rows = set()
    duplicate_count = 0

    for dataframe_index, source_row in frame.iterrows():
        original = {column: _serialize_upload_cell(source_row[column]) for column in frame.columns}
        features, normalized_sex, reasons = _validate_batch_row(source_row)
        row_number = int(dataframe_index) + 2
        if reasons:
            rejected_rows.append({"row_number": row_number, "reasons": reasons})
            continue

        feature_row = {feature: features[feature] for feature in BATCH_FEATURES}
        duplicate_key = tuple(feature_row[feature] for feature in BATCH_FEATURES)
        is_duplicate = duplicate_key in seen_feature_rows
        if is_duplicate:
            duplicate_count += 1
        else:
            seen_feature_rows.add(duplicate_key)

        feature_row["Sex"] = features["Sex"]
        valid_feature_rows.append(feature_row)
        valid_row_details.append({
            "row_number": row_number,
            "original": original,
            "normalized_sex": normalized_sex,
            "duplicate_input": is_duplicate,
            "age_within_observed_range": (
                OBSERVED_DATASET_AGE_MIN <= feature_row["Age"] <= OBSERVED_DATASET_AGE_MAX
            ),
        })

    predictions = []
    if valid_feature_rows:
        model_frame = pd.DataFrame(valid_feature_rows, columns=BATCH_FEATURES)
        try:
            predictions = [str(label) for label in loaded_pipeline.predict(model_frame)]
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Batch prediction failed. No results were produced: {error}",
            ) from error
        if len(predictions) != len(valid_row_details):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Batch prediction failed because model outputs did not match the valid input rows.",
            )

    prediction_classes = [str(label) for label in getattr(loaded_pipeline, "classes_", [])]
    for prediction in predictions:
        if prediction not in prediction_classes:
            prediction_classes.append(prediction)
    successful_count = len(predictions)
    class_counts = {label: predictions.count(label) for label in prediction_classes}
    class_distribution = {
        label: {
            "count": count,
            "percentage": round(count * 100 / successful_count, 1) if successful_count else 0,
        }
        for label, count in class_counts.items()
    }
    unsupported_age_records = sum(
        not row_details["age_within_observed_range"] for row_details in valid_row_details
    )
    batch_disclaimer = (
        "This result represents a machine learning prediction based on the available dataset. "
        "It is not a confirmed medical diagnosis."
    )
    if unsupported_age_records:
        batch_disclaimer = f"{batch_disclaimer} {UNSUPPORTED_AGE_WARNING}"
    results = [
        {
            "row_number": row_details["row_number"],
            "original": row_details["original"],
            "normalized_sex": row_details["normalized_sex"],
            "predicted_status": prediction,
            "duplicate_input": row_details["duplicate_input"],
            "age_within_observed_range": row_details["age_within_observed_range"],
        }
        for row_details, prediction in zip(valid_row_details, predictions)
    ]

    return {
        "success": True,
        "filename": Path(filename).name,
        "input_columns": list(frame.columns),
        "required_columns": BATCH_FEATURES,
        "prediction_column": "Predicted Status",
        "ground_truth_column_present": "Status" in frame.columns,
        "target_column_used_as_feature": False,
        "summary": {
            "total_records": int(len(frame)),
            "valid_records": int(len(valid_feature_rows)),
            "rejected_records": int(len(rejected_rows)),
            "successfully_predicted_records": successful_count,
            "duplicate_input_records": duplicate_count,
            "unsupported_age_records": unsupported_age_records,
            "percentage_denominator": successful_count,
            "predicted_class_counts": class_counts,
            "predicted_class_distribution": class_distribution,
        },
        "results": results,
        "rejected_rows": rejected_rows,
        "disclaimer": batch_disclaimer,
    }


@app.get("/api/explain")
def _reject_explain_get():
    """Do not accept measurements in query strings that may be retained by request logs."""
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Use POST /api/explain with a JSON body. Screening measurements are not accepted in URL query strings.",
    )


def explain_prediction(Sex: str, Age: int, Height: float, Weight: float):
    """Direct-call helper returning model-specific local sensitivity checks."""
    return run_model_inference(Sex, Age, Height, Weight)


@app.post("/api/explain")
def explain_prediction_post(payload: PredictionInput):
    return run_model_inference(
        sex_val=payload.Sex,
        age_val=payload.Age,
        height_val=payload.Height,
        weight_val=payload.Weight,
    )


def predict_get(Sex: str, Age: str, Height: str, Weight: str):
    """Legacy input parser retained for direct callers, not exposed as a GET endpoint."""
    # Validate and parse numerical inputs
    try:
        parsed_age = int(Age)
        parsed_height = float(Height)
        parsed_weight = float(Weight)
    except ValueError:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Invalid input. Age must be an integer, Height and Weight must be numeric."}
        )

    # Validate range
    if parsed_age < MIN_SCREENING_AGE or parsed_age > MAX_SCREENING_AGE:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Age must be between 1 and 21 years, inclusive."}
        )
    if parsed_height <= 20 or parsed_height > 250:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Height must be between 20 cm and 250 cm."}
        )
    if parsed_weight <= 1 or parsed_weight > 150:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Weight must be between 1 kg and 150 kg."}
        )

    # Validate Sex
    if Sex.strip().lower() not in ["male", "female"]:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Invalid input for Sex. Use 'male' or 'female'."}
        )

    try:
        result = run_model_inference(
            sex_val=Sex,
            age_val=parsed_age,
            height_val=parsed_height,
            weight_val=parsed_weight,
        )
        return result
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"error": e.detail})
    except Exception:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "The prediction could not be completed. Check the server model status and try again."}
        )


@app.post("/api/predict")
def predict_post(payload: PredictionInput):
    """Modern JSON POST endpoint for prediction queries"""
    return run_model_inference(
        sex_val=payload.Sex,
        age_val=payload.Age,
        height_val=payload.Height,
        weight_val=payload.Weight,
    )


@app.post("/Predict")
def predict_legacy_post(payload: PredictionInput):
    """Keep the legacy URL while requiring JSON so measurements are not logged in the URL."""
    return run_model_inference(
        sex_val=payload.Sex,
        age_val=payload.Age,
        height_val=payload.Height,
        weight_val=payload.Weight,
    )


@app.get("/Predict", include_in_schema=False)
def reject_legacy_get():
    """Reject sensitive screening measurements in URL query strings."""
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Use POST /api/predict with a JSON body. Screening measurements are not accepted in URL query strings.",
    )


@app.post("/api/report")
def screening_report(payload: PredictionInput):
    """Generate a PDF from a fresh model prediction, never from a client-supplied result label."""
    result = run_model_inference(
        sex_val=payload.Sex,
        age_val=payload.Age,
        height_val=payload.Height,
        weight_val=payload.Weight,
    )
    report_bytes = build_screening_pdf(result)
    report_date = datetime.fromisoformat(result["timestamp"]).strftime("%Y%m%d")
    return Response(
        content=report_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="nutrishield-screening-{report_date}.pdf"',
            "Cache-Control": "no-store",
        },
    )


# Mount static assets if the static directory exists
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def read_root():
    """Serves the NutriShield web application interface."""
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        index_file = BASE_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {
        "app": "NutriShield – AI-Powered Child Nutrition Screening and Monitoring System",
        "status": "online",
        "documentation": "/docs",
        "message": "Frontend index.html is being prepared."
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
