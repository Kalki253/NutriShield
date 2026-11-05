"""
NutriShield Direct Test Suite
Validates:
1. Model loading and pipeline integrity
2. HTTP API execution (/api/predict, /api/report, /api/status, /)
3. Prediction accuracy on known dataset samples
4. Input validation and error cases
5. Static file integrity
6. Honest held-out evaluation status
"""

import io
import math
import sqlite3
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import app
from fastapi.testclient import TestClient

_TEST_DATABASE = TemporaryDirectory()
app.storage.configure_database(Path(_TEST_DATABASE.name) / "screenings.sqlite3")


def run_tests():
    print("=== STARTING NUTRISHIELD DIRECT SUITE ===", flush=True)

    # 1. Model status check
    print("\n1. Testing get_system_status()...", flush=True)
    status = app.get_system_status()
    print("Status result:", status, flush=True)
    assert status["status"] == "online"
    assert status["model_loaded"] is True
    assert status["model_file"] == "new_svm_with_grid_search.joblib"
    assert status["app"] == "NutriShield – AI-Powered Child Nutrition Screening and Monitoring System"
    assert status["child_specificity_verified"] is False
    assert status["clinical_validation_verified"] is False
    assert "Stunting" in status["classes"]
    assert "Wasting" in status["classes"]
    assert "Underweight" in status["classes"]
    assert "Overweight" in status["classes"]
    assert "Normal" not in status["classes"]
    print("-> PASSED: get_system_status()", flush=True)

    # 2. Test GET /Predict with Stunting sample (Male, Age 5, Height 75, Weight 17)
    print("\n2. Testing predict_get for Stunting sample...", flush=True)
    p1 = app.predict_get(Sex="male", Age="5", Height="75", Weight="17")
    print("Prediction result:", p1, flush=True)
    assert isinstance(p1, dict)
    assert p1["Detected as"] == "Stunting"
    assert p1["Sex"] == "Male"
    assert p1["Age"] == 5
    assert p1["Height"] == 75.0
    assert p1["Weight"] == 17.0
    assert p1["status"] == "success"
    print("-> PASSED: Stunting sample detected correctly", flush=True)

    # 3. Test GET /Predict with Overweight sample (Male, Age 1, Height 88, Weight 9)
    print("\n3. Testing predict_get for Overweight sample...", flush=True)
    p2 = app.predict_get(Sex="male", Age="1", Height="88", Weight="9")
    print("Prediction result:", p2, flush=True)
    assert p2["Detected as"] == "Overweight"
    print("-> PASSED: Overweight sample detected correctly", flush=True)

    # 4. Test GET /Predict with Wasting sample (Male, Age 3, Height 106, Weight 9)
    print("\n4. Testing predict_get for Wasting sample...", flush=True)
    p3 = app.predict_get(Sex="male", Age="3", Height="106", Weight="9")
    print("Prediction result:", p3, flush=True)
    assert p3["Detected as"] == "Wasting"
    print("-> PASSED: Wasting sample detected correctly", flush=True)

    # 5. Test GET /Predict with Underweight sample (Male, Age 3, Height 104, Weight 12)
    print("\n5. Testing predict_get for Underweight sample...", flush=True)
    p4 = app.predict_get(Sex="male", Age="3", Height="104", Weight="12")
    print("Prediction result:", p4, flush=True)
    assert p4["Detected as"] == "Underweight"
    print("-> PASSED: Underweight sample detected correctly", flush=True)

    # 6. Test POST /api/predict endpoint
    print("\n6. Testing predict_post with Pydantic payload...", flush=True)
    payload = app.PredictionInput(Sex="female", Age=4, Height=101.0, Weight=13.0)
    p5 = app.predict_post(payload)
    print("POST result:", p5, flush=True)
    assert "Detected as" in p5
    assert p5["status"] == "success"
    print(f"-> PASSED: POST prediction detected as {p5['Detected as']}", flush=True)

    # 7. Test Input Validation: Invalid Sex
    print("\n7. Testing input validation - invalid Sex...", flush=True)
    err_sex = app.predict_get(Sex="robot", Age="3", Height="85", Weight="12")
    assert err_sex.status_code == 400
    print("-> PASSED: Invalid sex returned 400", flush=True)

    # 8. Test Input Validation: Non-numeric Age
    print("\n8. Testing input validation - non-numeric Age...", flush=True)
    err_age = app.predict_get(Sex="male", Age="not_a_number", Height="85", Weight="12")
    assert err_age.status_code == 400
    print("-> PASSED: Non-numeric age returned 400", flush=True)

    # 9. Test Input Validation: Out-of-bounds Height
    print("\n9. Testing input validation - out-of-bounds Height...", flush=True)
    err_h = app.predict_get(Sex="male", Age="3", Height="999", Weight="12")
    assert err_h.status_code == 400
    print("-> PASSED: Out-of-bounds height returned 400", flush=True)

    # 10. Test Root endpoint (read_root)
    print("\n10. Testing read_root()...", flush=True)
    root_res = app.read_root()
    assert hasattr(root_res, "path")
    assert Path(root_res.path).exists()
    print("-> PASSED: read_root() returned FileResponse pointing to existing file", flush=True)

    # 11. Test Static files existence
    print("\n11. Testing static files existence...", flush=True)
    assert (app.STATIC_DIR / "index.html").exists()
    assert (app.STATIC_DIR / "css" / "style.css").exists()
    assert (app.STATIC_DIR / "js" / "app.js").exists()
    assert (app.STATIC_DIR / "js" / "translations.js").exists()
    assert (app.STATIC_DIR / "favicon.svg").exists()
    print("-> PASSED: All static assets verified on disk", flush=True)

    # 12. Test dedicated local SVM sensitivity output.
    print("\n12. Testing /api/explain endpoint...", flush=True)
    exp = app.explain_prediction(Sex="male", Age=5, Height=75.0, Weight=17.0)
    assert "explainability" in exp
    assert exp["explainability"]["available"] is True
    assert exp["explainability"]["method"] == "one_feature_at_a_time"
    assert "causation" in exp["explainability"]["note_en"]
    assert all(feature["variants"] for feature in exp["explainability"]["features"])
    print("-> PASSED: SVM sensitivity checks are based on actual perturbed predictions", flush=True)

    # 13. Test BMI computation helper
    print("\n13. Testing compute_bmi()...", flush=True)
    bmi = app.compute_bmi(100.0, 16.0) # 16 / (1.0)^2 = 16.0
    assert bmi == 16.0
    bmi2 = app.compute_bmi(85.0, 12.0) # 12 / (0.85)^2 = 16.61
    assert bmi2 == 16.61
    print("-> PASSED: compute_bmi() calculation verified", flush=True)

    # 14. Reconstructed metrics must be reproducible and remain distinct from the saved model.
    print("\n14. Testing reconstructed model-performance disclosure...", flush=True)
    metrics = app.get_model_metrics()
    assert metrics["available"] is True
    assert metrics["evaluation_status"] == "reconstructed_holdout_evaluation"
    assert metrics["saved_artifact_metrics_available"] is False
    assert set(metrics["metrics"]) == {
        "accuracy", "precision_macro", "recall_macro", "f1_macro", "f1_weighted"
    }
    assert all(0 <= value <= 1 for value in metrics["metrics"].values())
    assert set(metrics["class_metrics"]) == set(metrics["classes"])
    assert set(metrics["model_comparison"]["candidates"]) == {
        "reconstructed_svc", "reconstructed_random_forest"
    }
    assert metrics["model_comparison"]["deployed_model_changed"] is False
    assert all(
        math.isfinite(candidate["validation_macro_f1"])
        and 0 <= candidate["validation_macro_f1"] <= 1
        for candidate in metrics["model_comparison"]["candidates"].values()
    )
    assert metrics["roc_auc"]["available"] is False
    assert len(metrics["confusion_matrix"]) == len(metrics["classes"]) == 4
    assert all(len(row) == len(metrics["classes"]) for row in metrics["confusion_matrix"])
    assert metrics["target"] == "Status"
    assert metrics["dataset_rows"] == 793
    assert metrics["source_dataset_rows"] == 837
    assert metrics["class_counts"] == {
        "Overweight": 94,
        "Stunting": 696,
        "Underweight": 43,
        "Wasting": 4,
    }
    assert metrics["evaluation_methodology"]["dataset_split"].startswith("Deterministic stratified-group holdout")
    assert "random oversampling" in metrics["evaluation_methodology"]["training_pipeline"].lower()
    assert metrics["evaluation_methodology"]["rare_test_classes"] == {"Wasting": 1}
    assert metrics["dataset_summary"]["data_quality"]["duplicate_rows"] >= 0
    assert metrics["dataset_summary"]["data_quality"]["invalid_model_feature_rows"] == 0
    print("-> PASSED: reconstructed metrics are reported separately with rare-class caveat", flush=True)

    print("\n15. Testing migration from the previous account-scoped database...", flush=True)
    legacy_database = Path(_TEST_DATABASE.name) / "legacy.sqlite3"
    with sqlite3.connect(legacy_database) as connection:
        connection.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
            CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER);
            CREATE TABLE screenings (
                id TEXT PRIMARY KEY,
                owner_user_id INTEGER,
                child_code TEXT,
                sex TEXT,
                age INTEGER CHECK (age BETWEEN 1 AND 5),
                height REAL,
                weight REAL,
                bmi REAL,
                predicted_status TEXT,
                model_version TEXT,
                explainability_json TEXT,
                screened_at TEXT,
                created_at TEXT
            );
            INSERT INTO users VALUES (1, 'legacy-worker', 'legacy-hash');
            INSERT INTO sessions VALUES ('legacy-token', 1);
            INSERT INTO screenings VALUES (
                'legacy-record', 1, 'C-LEGACY', 'Male', 3, 90, 12, 14.81,
                'Stunting', 'legacy-model', NULL, '2026-01-01T00:00:00+00:00',
                '2026-01-01T00:00:00+00:00'
            );
            """
        )
    connection.close()
    app.storage.configure_database(legacy_database)
    app.storage.initialize_database()
    migrated_records = app.storage.list_screenings()
    assert len(migrated_records) == 1
    assert migrated_records[0]["id"] == "legacy-record"
    assert migrated_records[0]["child_code"] == "C-LEGACY"
    with sqlite3.connect(legacy_database) as connection:
        remaining_tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        screening_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(screenings)")
        }
        screening_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'screenings'"
        ).fetchone()[0]
    connection.close()
    assert "users" not in remaining_tables and "sessions" not in remaining_tables
    assert "owner_user_id" not in screening_columns
    assert "BETWEEN 1 AND 21" in screening_schema
    age_21_record = app.storage.create_screening({
        "child_code": "C-AGE21",
        "sex": "Female",
        "age": 21,
        "height": 170,
        "weight": 60,
        "bmi": 20.76,
        "predicted_status": "Overweight",
        "model_version": "test-model",
        "explainability_json": None,
        "screened_at": "2026-01-02T00:00:00+00:00",
    })
    assert age_21_record["age"] == 21
    app.storage.configure_database(Path(_TEST_DATABASE.name) / "screenings.sqlite3")
    app.storage.initialize_database()
    print("-> PASSED: legacy records are preserved and account/session tables are removed", flush=True)

    # 15. Exercise real HTTP behavior, including the PDF download and privacy-safe methods.
    print("\n16. Testing HTTP routes and PDF generation...", flush=True)
    with TestClient(app.app) as client:
        homepage = client.get("/")
        assert homepage.status_code == 200
        assert 'id="authGate"' not in homepage.text
        assert 'id="loginForm"' not in homepage.text
        assert 'id="registerForm"' not in homepage.text
        assert 'id="appRoot" hidden' not in homepage.text
        assert "Sign in to NutriShield" not in homepage.text
        assert "Create a healthcare-worker account" not in homepage.text
        assert homepage.text.count('class="view-section') == 6
        assert "NutriShield – AI-Powered Child Nutrition Screening and Monitoring System" in homepage.text
        assert "Smarter Screening. Healthier Futures." in homepage.text
        assert homepage.text.count('class="view-section') == 6
        assert 'data-view="about"' not in homepage.text
        assert 'id="about-view"' not in homepage.text
        assert 'id="saveHistoryBtn"' in homepage.text
        assert 'id="inputAge" class="form-control" min="1" max="21" step="1" placeholder="e.g., 3" required' in homepage.text
        assert "Enter an age from 1 to 21 years. The available dataset and saved model support vectors cover ages 1–5 only; predictions for ages 6–21 are unvalidated extrapolations." in homepage.text
        assert 'id="ageValidationNotice"' in homepage.text
        assert "837 Source Records" not in homepage.text
        assert "SMOTE Balanced (696/class)" not in homepage.text
        assert "AI-generated results are intended for preliminary educational screening and should not replace professional medical assessment." in homepage.text
        assert "Model Performance and Evaluation" in homepage.text
        assert "Evaluation methodology and limitations" in homepage.text
        assert 'id="evaluationMethodology"' in homepage.text
        assert 'id="evaluationLimitations"' in homepage.text
        assert "Enter the child's biometric measurements to generate an AI-based nutritional classification." in homepage.text
        assert "Results are based on the available dataset and should be interpreted with professional healthcare guidance." in homepage.text
        assert "This result represents a machine learning prediction based on the available dataset. It is not a confirmed medical diagnosis." in homepage.text
        assert "Food recommendations are general educational information, not personalized medical advice. Consider the child's age, allergies, feeding stage and dietary needs. Consult a qualified healthcare professional if a nutritional deficiency is suspected." in homepage.text
        assert homepage.text.count("AI-generated results are intended for preliminary educational screening") == 1
        assert homepage.text.count('class="nutrition-card"') == 6
        assert homepage.text.count('class="nutrient-food-button"') == 12
        assert "Explore general food sources and nutritional information to support awareness of balanced child nutrition." in homepage.text
        assert "The screening model does not assess nutrient deficiencies." in homepage.text
        assert homepage.text.count("Specific nutrient deficiencies cannot be determined from the current screening model.") == 2
        assert "No nutrient deficiencies are assigned to individual batch rows." in homepage.text
        assert "Nutrient Deficiency Information" in homepage.text
        assert homepage.text.count("Explore Foods by Nutrient") == 2
        assert 'id="openNutritionGuidanceBtn"' in homepage.text
        assert 'id="predictionNutritionGuidance"' in homepage.text
        assert 'id="batchNutritionGuidance"' in homepage.text
        nutrient_script = (app.STATIC_DIR / "js" / "app.js").read_text(encoding="utf-8")
        assert "const isLoopbackHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);" in nutrient_script
        assert "if ((protocol === 'http:' || protocol === 'https:') && !isLoopbackHost)" in nutrient_script
        assert "MODEL_PERFORMANCE_TIMEOUT_MS = 90000" in nutrient_script
        assert "requestJson('/api/model-performance', { timeoutMs: MODEL_PERFORMANCE_TIMEOUT_MS }, true)" in nutrient_script
        assert "Age must be a whole number from 1 to 21 years, inclusive." in nutrient_script
        assert "unvalidated model extrapolation" in nutrient_script
        assert "age_within_observed_range" in nutrient_script
        for nutrient_food in [
            "Iron-Rich Foods", "Vitamin A-Rich Foods", "Calcium-Rich Foods",
            "Protein-Rich Foods", "Vitamin C-Rich Foods", "Folate-Rich Foods",
            "Lentils", "Chickpeas", "Iron-fortified foods", "Carrots", "Pumpkin",
            "Sweet potato", "Dark green leafy vegetables", "Eggs", "Milk", "Curd",
            "Cheese", "Calcium-fortified foods", "Beans", "Peas", "Fish", "Guava",
            "Amla", "Oranges", "Tomatoes", "Spinach", "Food safety:",
            "Close food information",
        ]:
            assert nutrient_food in nutrient_script, f"Missing nutrient education content: {nutrient_food}"
        for guidance_category in ["Overweight", "Underweight", "Stunting", "Wasting"]:
            assert f"    {guidance_category}: {{" in nutrient_script, f"Missing category guidance: {guidance_category}"
        assert "data-guidance-row" in nutrient_script
        assert "No category-specific food examples are available." in nutrient_script
        for image_name in [
            "grains.svg", "vegetables.svg", "fruits.svg", "protein.svg",
            "dairy.svg", "healthy-fats.svg", "healthy-habits.svg",
        ]:
            assert (app.STATIC_DIR / "foods" / image_name).is_file()
            image_response = client.get(f"/static/foods/{image_name}")
            assert image_response.status_code == 200
            assert image_response.headers["content-type"].startswith("image/svg+xml")
        assert "    Normal: {" not in nutrient_script
        assert "data-edu-tab" not in homepage.text
        assert client.get("/api/status").json()["model_loaded"] is True
        record_preflight = client.options(
            "/api/screenings/test-record",
            headers={
                "Origin": "http://localhost:5500",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "content-type,x-csrf-token",
            },
        )
        assert record_preflight.status_code == 200
        allowed_methods = record_preflight.headers["access-control-allow-methods"]
        assert "PATCH" in allowed_methods and "DELETE" in allowed_methods
        dedicated_health = client.get("/health")
        assert dedicated_health.status_code == 200
        assert dedicated_health.json()["status"] == "online"
        assert dedicated_health.json()["api"] == "FastAPI"
        assert dedicated_health.json()["model_loaded"] is True
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "connected"
        assert health.json()["model_loaded"] is True
        assert health.json()["dataset_available"] is True
        dataset_summary = client.get("/api/dataset-summary")
        assert dataset_summary.status_code == 200
        assert dataset_summary.json()["labeled_rows"] == 837
        assert dataset_summary.json()["class_counts"] == metrics["class_counts"]
        performance = client.get("/api/model-performance")
        assert performance.status_code == 200
        assert performance.json()["metrics"] == metrics["metrics"]
        assert performance.json()["saved_artifact_metrics_available"] is False
        assert client.get("/api/auth/session").status_code == 404
        assert client.post("/api/auth/login", json={}).status_code == 404
        assert client.post("/api/auth/register", json={}).status_code == 404
        assert client.post(
            "/api/predict",
            json={"Sex": "male", "Age": 5, "Height": 75, "Weight": 17},
        ).status_code == 200
        api_prediction = client.post(
            "/api/predict",
            json={"Sex": "male", "Age": 5, "Height": 75, "Weight": 17},
        )
        assert api_prediction.status_code == 200
        assert api_prediction.json()["Detected as"] == "Stunting"
        assert api_prediction.json()["child_specificity_verified"] is False
        assert api_prediction.json()["disclaimer"] == (
            "This result represents a machine learning prediction based on the available dataset. "
            "It is not a confirmed medical diagnosis."
        )
        assert not any("nutrient" in key.casefold() for key in api_prediction.json())
        legacy_prediction = client.post("/Predict", json={"Sex": "male", "Age": 5, "Height": 75, "Weight": 17})
        assert legacy_prediction.status_code == 200
        assert legacy_prediction.json()["Detected as"] == "Stunting"

        saved_screening = client.post(
            "/api/screenings",
            json={"Sex": "male", "Age": 5, "Height": 75, "Weight": 17, "child_code": "C-001"},
        )
        assert saved_screening.status_code == 201
        saved_record = saved_screening.json()["record"]
        assert saved_record["child_code"] == "C-001"
        assert saved_record["predicted_status"] == "Stunting"
        record_id = saved_record["id"]
        assert client.get("/api/screenings").json()["records"][0]["id"] == record_id
        assert client.get("/api/dashboard-summary").json()["total_screenings"] == 1
        assert "C-001" in client.get("/api/screenings/export.csv").text

        edited_screening = client.patch(
            f"/api/screenings/{record_id}",
            json={"Sex": "male", "Age": 5, "Height": 76, "Weight": 17, "child_code": "C-002"},
        )
        assert edited_screening.status_code == 200
        assert edited_screening.json()["record"]["child_code"] == "C-002"
        assert edited_screening.json()["record"]["height"] == 76

        assert len(client.get("/api/screenings").json()["records"]) == 1
        assert client.delete(f"/api/screenings/{record_id}").status_code == 200
        assert client.get("/api/screenings").json()["records"] == []

        # 16. Test stateless batch prediction, validation, row mapping, and exports.
        batch_csv = (
            b"Sex,Age,Height,Weight,Status,ChildID\n"
            b"Male,21,75,17,not-a-label,C01\n"
            b"1,3,106,9,ignored,C02\n"
            b"Other,2,70,10,ignored,C03\n"
            b"Female,nope,90,12,ignored,C04\n"
            b"Male,21,75,17,other,C05\n"
            b"Female,22,90,12,ignored,C06\n"
            b"Female,0,90,12,ignored,C07\n"
        )
        batch = client.post(
            "/api/batch-predict",
            files={"upload": ("children.csv", batch_csv, "text/csv")},
        )
        assert batch.status_code == 200
        batch_data = batch.json()
        assert batch_data["success"] is True
        assert batch_data["ground_truth_column_present"] is True
        assert batch_data["target_column_used_as_feature"] is False
        assert batch_data["summary"]["total_records"] == 7
        assert batch_data["summary"]["valid_records"] == 3
        assert batch_data["summary"]["rejected_records"] == 4
        assert batch_data["summary"]["successfully_predicted_records"] == 3
        assert batch_data["summary"]["percentage_denominator"] == 3
        assert batch_data["summary"]["duplicate_input_records"] == 1
        assert batch_data["summary"]["unsupported_age_records"] == 2
        assert [row["row_number"] for row in batch_data["results"]] == [2, 3, 6]
        assert [row["row_number"] for row in batch_data["rejected_rows"]] == [4, 5, 7, 8]
        assert any("Sex" in reason for reason in batch_data["rejected_rows"][0]["reasons"])
        assert any("Age" in reason for reason in batch_data["rejected_rows"][1]["reasons"])
        assert any("between 1 and 21 years" in reason for reason in batch_data["rejected_rows"][2]["reasons"])
        assert any("between 1 and 21 years" in reason for reason in batch_data["rejected_rows"][3]["reasons"])
        assert batch_data["results"][0]["original"]["Status"] == "not-a-label"
        assert batch_data["results"][0]["predicted_status"] == "Stunting"
        assert batch_data["results"][0]["age_within_observed_range"] is False
        assert batch_data["results"][1]["age_within_observed_range"] is True
        assert "unvalidated model extrapolations" in batch_data["disclaimer"]
        assert all(
            not any("nutrient" in key.casefold() for key in row)
            for row in batch_data["results"]
        )
        expected_batch = app.loaded_pipeline.predict(app.pd.DataFrame([
            {"Sex": 1, "Age": 21, "Height": 75.0, "Weight": 17.0},
            {"Sex": 1, "Age": 3, "Height": 106.0, "Weight": 9.0},
            {"Sex": 1, "Age": 21, "Height": 75.0, "Weight": 17.0},
        ], columns=app.BATCH_FEATURES))
        assert [row["predicted_status"] for row in batch_data["results"]] == [str(value) for value in expected_batch]

        template = client.get("/api/batch-template")
        assert template.status_code == 200
        assert template.text == "Sex,Age,Height,Weight\n"
        assert template.headers["content-disposition"].endswith('"nutrishield-batch-template.csv"')

        missing_batch_columns = client.post(
            "/api/batch-predict",
            files={"upload": ("missing.csv", b"Sex,Age\nMale,3\n", "text/csv")},
        )
        assert missing_batch_columns.status_code == 422
        assert "Height, Weight" in missing_batch_columns.json()["detail"]
        empty_batch = client.post("/api/batch-predict", files={"upload": ("empty.csv", b"", "text/csv")})
        assert empty_batch.status_code == 400
        unsupported_batch = client.post("/api/batch-predict", files={"upload": ("script.py", b"print(1)", "text/plain")})
        assert unsupported_batch.status_code == 415
        malformed_excel = client.post(
            "/api/batch-predict",
            files={"upload": ("broken.xlsx", b"not an excel workbook", "application/octet-stream")},
        )
        assert malformed_excel.status_code == 400

        workbook = io.BytesIO()
        app.pd.DataFrame([{"Sex": "Female", "Age": 2, "Height": 90, "Weight": 12, "Status": "ignored"}]).to_excel(workbook, index=False)
        excel_batch = client.post(
            "/api/batch-predict",
            files={"upload": ("children.xlsx", workbook.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert excel_batch.status_code == 200
        assert excel_batch.json()["summary"]["successfully_predicted_records"] == 1

        saved_pipeline = app.loaded_pipeline
        try:
            app.loaded_pipeline = None
            failed_batch = client.post(
                "/api/batch-predict",
                files={"upload": ("children.csv", batch_csv, "text/csv")},
            )
            assert failed_batch.status_code == 503
            assert failed_batch.json()["detail"].startswith("Saved model unavailable")
        finally:
            app.loaded_pipeline = saved_pipeline

        below_minimum_age = client.post(
            "/api/predict", json={"Sex": "male", "Age": 0, "Height": 75, "Weight": 17}
        )
        above_maximum_age = client.post(
            "/api/predict", json={"Sex": "male", "Age": 22, "Height": 75, "Weight": 17}
        )
        assert below_minimum_age.status_code == above_maximum_age.status_code == 422
        assert "Age must be between 1 and 21 years, inclusive." in str(below_minimum_age.json()["detail"])
        assert "Age must be between 1 and 21 years, inclusive." in str(above_maximum_age.json()["detail"])
        for accepted_age in (1, 21):
            accepted = client.post(
                "/api/predict",
                json={"Sex": "male", "Age": accepted_age, "Height": 100, "Weight": 20},
            )
            assert accepted.status_code == 200
            assert accepted.json()["Age"] == accepted_age
        unsupported_age_prediction = client.post(
            "/api/predict",
            json={"Sex": "male", "Age": 6, "Height": 100, "Weight": 20},
        )
        assert unsupported_age_prediction.status_code == 200
        assert unsupported_age_prediction.json()["age_within_observed_range"] is False
        assert "unvalidated model extrapolations" in unsupported_age_prediction.json()["disclaimer"]
        assert client.get("/Predict?Sex=male&Age=5&Height=75&Weight=17").status_code == 405
        report = client.post("/api/report", json={"Sex": "male", "Age": 5, "Height": 75, "Weight": 17})
        assert report.status_code == 200
        assert report.headers["content-type"] == "application/pdf"
        assert report.headers["content-disposition"].startswith('attachment; filename="nutrishield-screening-')
        assert report.content.startswith(b"%PDF-1.4")
        assert b"NutriShield" in report.content
        assert b"Predicted nutritional classification: Stunting" in report.content
        assert b"This result represents a machine learning prediction based on the available dataset." in report.content
        assert b"It is not a confirmed medical diagnosis." in report.content
        unsupported_age_report = client.post(
            "/api/report", json={"Sex": "male", "Age": 21, "Height": 170, "Weight": 60}
        )
        assert unsupported_age_report.status_code == 200
        assert b"unvalidated model extrapolation" in unsupported_age_report.content
        metrics_response = client.get("/api/model-metrics").json()
        assert metrics_response["class_counts"] == metrics["class_counts"]
        original_dataset_path = app.DATASET_PATH
        original_pipeline = app.loaded_pipeline
        try:
            with TemporaryDirectory() as temporary_directory:
                app.DATASET_PATH = Path(temporary_directory) / "missing.csv"
                unavailable_health = client.get("/api/health")
                assert unavailable_health.status_code == 503
                assert unavailable_health.json()["backend_online"] is True
                assert unavailable_health.json()["dataset_available"] is False
                assert client.get("/api/dataset-summary").status_code == 503
                assert client.get("/api/model-performance").status_code == 503

                app.DATASET_PATH = Path(temporary_directory) / "missing-target.csv"
                app.DATASET_PATH.write_text("Age\n3\n", encoding="utf-8")
                missing_target = client.get("/api/dataset-summary")
                assert missing_target.status_code == 503
                assert missing_target.json()["reason_code"] == "target_column_missing"

                app.DATASET_PATH = Path(temporary_directory) / "empty.csv"
                app.DATASET_PATH.write_text("", encoding="utf-8")
                invalid_csv = client.get("/api/dataset-summary")
                assert invalid_csv.status_code == 503
                assert invalid_csv.json()["reason_code"] == "dataset_read_error"
            app.DATASET_PATH = original_dataset_path
            app.loaded_pipeline = None
            unavailable_model = client.get("/api/health")
            assert unavailable_model.status_code == 503
            assert unavailable_model.json()["backend_online"] is True
            assert unavailable_model.json()["model_loaded"] is False
            unavailable_dedicated_health = client.get("/health")
            assert unavailable_dedicated_health.status_code == 503
            assert unavailable_dedicated_health.json()["status"] == "degraded"
            assert unavailable_dedicated_health.json()["model_loaded"] is False
        finally:
            app.DATASET_PATH = original_dataset_path
            app.loaded_pipeline = original_pipeline
    print("-> PASSED: API, validation, PDF prediction and metrics status", flush=True)
    print("-> PASSED: health reflects missing dataset and model dependencies", flush=True)

    # 17. Test ML model loading safety, missing files, corrupted files, and recovery
    print("\n17. Testing ML model loading error handling and recovery...", flush=True)
    with TemporaryDirectory() as temp_dir:
        missing_path = Path(temp_dir) / "missing_model.joblib"
        assert app.load_ml_model(missing_path) is None
        assert "not found" in app.model_load_error.lower()

        empty_path = Path(temp_dir) / "empty_model.joblib"
        empty_path.write_bytes(b"")
        assert app.load_ml_model(empty_path) is None
        assert "empty" in app.model_load_error.lower()

        corrupt_path = Path(temp_dir) / "corrupt_model.joblib"
        corrupt_path.write_bytes(b"INVALID_HEADER_GARBAGE")
        assert app.load_ml_model(corrupt_path) is None
        assert "failed to load ml model" in app.model_load_error.lower()

        # Recovery test
        recovered = app.load_ml_model(app.MODEL_PATH)
        assert recovered is not None
        assert app.loaded_pipeline is not None
        assert app.model_load_error is None
    print("-> PASSED: Model loading handles missing, empty, corrupted files and recovers cleanly", flush=True)

    print("\n==========================================", flush=True)
    print("ALL 18 TEST GROUPS COMPLETED AND PASSED!", flush=True)
    print("==========================================", flush=True)

if __name__ == "__main__":
    run_tests()
