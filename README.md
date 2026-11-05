# NutriShield – AI-Powered Child Nutrition Screening and Monitoring System
**Smarter Screening. Healthier Futures.**
**Supporting child nutrition awareness through data-driven analysis.**

---

## 1. Project Overview & Safety Scope

**NutriShield** is a responsive screening and monitoring application built on the existing FastAPI backend and saved SVM classifier.

`Malnutrition data.csv` contains 837 rows, observed ages 1–5, and a `Status` column with four labels: Stunting, Overweight, Underweight, and Wasting. The dataset does not provide independently verifiable source documentation or clinical label definitions establishing that its observations are child-specific. These are dataset labels, not confirmed clinical outcomes.

The application uses the existing **Support Vector Machine (SVM with RBF kernel)** pipeline to produce real model outputs. Its local sensitivity panel tests one input change at a time. Neither model behavior nor a class label is a medical explanation, diagnosis, or treatment recommendation.

---

## 2. Core Features

### A. Explainable Machine Learning Predictions
- **Model Output:** Returns one of four labels from the saved SVM pipeline (`new_svm_with_grid_search.joblib`).
- **Local model sensitivity:** Tests sex by switching the encoded value and numeric features by approximately one fitted `StandardScaler` standard deviation. It displays a feature only when that test changes the predicted class. This demonstrates local model behavior, not medical causation.
- No fabricated confidence percentages, accuracy scores, or unsupported feature importance are presented.
- **PDF report:** Generates a fresh output with the saved model and includes the predicted class, date, measurements, raw BMI, general next steps, and a concise disclaimer.
- **Age input bounds:** Inputs accept whole ages 1–21 years. The source dataset and inspected saved-model support vectors cover ages 1–5 only. Ages 6–21 are accepted for model processing but are explicitly marked as unvalidated extrapolations; no training data or scientific validity is inferred for them.
- **Shared backend status:** The frontend checks `/api/health` on load, every 30 seconds, and when the page regains focus. It distinguishes an unreachable backend, an unavailable saved model, and a missing dataset, and provides a retry action.

### B. Batch Prediction
- Upload a CSV or XLSX file of Sex, Age, Height, and Weight values for model predictions.
- Invalid rows are reported and excluded. Uploaded files are processed in memory and are not stored on the server.
- Batch results do not infer or assign nutrient deficiencies to any row; the same general food explorer is available for learning.

### C. Nutrition & Growth Monitoring (Interactive Charts)
- **Longitudinal Tracking:** Save screening records to the server's SQLite database without signing in. Records are available to anyone who can access the application; use only a pseudonymous child code and avoid names or direct identifiers. Records are not encrypted at rest.
- **Interactive SVG Charts (Zero External Network Bloat):**
  - **Weight Trajectory Chart:** Visualizes weight progression over screening dates with hover tooltips.
  - **BMI Trend Chart:** Tracks raw BMI values over time; pediatric percentiles are not calculated.
  - **Model Output Chart:** Displays class labels from saved screenings; labels are not confirmed conditions.
- **Record Management:** Search and inspect saved screenings, edit or delete entries, and export records to CSV.
- The application has six sections: Dashboard, New Screening, Batch Prediction, Model Performance, Screening History, and Nutrition Guidance. Navigation changes the displayed section without a full-page reload.

### D. Child Nutrition Guidance
- Provides food examples for general learning, not condition-specific or personalized treatment.
- The screening dataset contains only Sex, Age, Height, Weight, and the `Status` classification target; it contains no nutrient-specific measurements or labels. The saved SVM predicts only the four `Status` classes and is not a deficiency-prediction model.
- Results explicitly state: “Specific nutrient deficiencies cannot be determined from the current screening model.” Six interactive food-source guides are available on individual and batch results without implying that any deficiency was detected.
- Each guide includes the nutrient's general role and age-appropriate food safety reminders. Selecting or closing a guide does not change model predictions.
- Individual and batch predictions also offer category-specific general Nutrition Guidance using the exact label returned by the saved model. The current model supports Overweight, Underweight, Stunting, and Wasting; it does not support a Normal category. Unknown outputs receive a safe fallback rather than guessed advice. Food-group illustrations are served locally from `static/foods/`.
- Guidance is general educational information, not personalized medical advice. It avoids supplement or treatment-dose recommendations.
- The project does not claim that its education content is aligned with ICMR-NIN or another clinical guideline.
- Health, feeding, or growth concerns should be discussed with a qualified healthcare professional.

### E. General Next Steps
- Provides general next steps to discuss health or growth concerns with a qualified healthcare professional.
- BMI is included as a raw calculation only. The app does not apply adult BMI categories or calculate pediatric age/sex percentiles.

### F. Model Evaluation Dashboard
- The source CSV has 837 rows and uses `Status` as its target: Stunting (696), Overweight (94), Underweight (43), and Wasting (4).
- The saved joblib artifact has no recorded split or test-prediction provenance, so metrics are not attributed to that deployed model.
- The API reconstructs separate SVC and random-forest candidates after removing exact feature/label duplicates. Identical feature tuples stay in the same deterministic stratified-group holdout and grouped cross-validation folds. Training-only random oversampling avoids synthetic feature generation when rare classes are too small for SMOTE; the held-out groups are not used in parameter tuning. The API records the split, parameters, class order, and confusion matrix.
- This reconstructed test split contains only one Wasting record, making its class-specific performance highly unstable. Source label validity is not verified, and these metrics are not clinical evidence.
- Dataset target-label counts are loaded from the CSV and shown separately from model-performance metrics.

### G. Voice Accessibility
- The result page keeps the screening output and guidance visible and offers optional browser text-to-speech.
- English speech is used only when an English browser voice is available; otherwise a visible status explains the limitation.
- Navigation and interactive controls support keyboard focus and screen-reader status announcements.

---

## 3. Project Directory Structure

```
IBM/
├── app.py                            # FastAPI backend with ML inference, explainability, & static file serving
├── storage.py                        # SQLite persistence for screening records
├── compute_metrics.py                # Reproducible reconstructed evaluation report
├── app.py.backup                     # Original backend backup
├── requirements.txt                  # Runtime dependencies; imbalanced-learn supports training-only resampling
├── new_svm_with_grid_search.joblib   # Trained SVM pipeline (StandardScaler + SVC with RBF kernel)
├── svm_model.joblib                  # Alternate trained SVM pipeline
├── random_forest_model.joblib        # Trained Random Forest model
├── Malnutrition data.csv             # Original dataset (837 records; target: Status)
├── resampled_data.csv                # Historical SMOTE output; not used for leakage-safe evaluation
├── Xtrain.csv                        # Training feature matrix
├── MalnutritionDetect.ipynb          # Exploratory data analysis & model training notebook
├── Oversampling on the whole dataset.ipynb  # Historical exploration; warning and split-before-oversampling workflow
├── SMOTE.ipynb                       # Additional SMOTE balancing experiments
├── test_suite.py                     # Backend, model, privacy, metrics, and PDF regression suite
├── README.md                         # Comprehensive project documentation
├── index.html                        # Root web entrypoint
├── .gitignore                         # Excludes virtualenvs, secrets, caches, and SQLite files
├── data/                              # Created at startup for the local SQLite database
│
└── static/                           # Dedicated web application assets
    ├── index.html                    # NutriShield single-page application
    ├── favicon.svg                   # Medical shield SVG favicon
    ├── css/
    │   └── style.css                 # Medical design system, accessible typography & layouts
    ├── foods/                        # Local food-group illustrations used by dynamic guidance
    └── js/
        ├── translations.js           # English interface text
        └── app.js                    # Controller: router, API client, charts, & server-side history
```

---

## 4. How to Run in Windows PowerShell / VS Code

### Step 1: Open PowerShell in the Project Directory
```powershell
cd C:\path\to\IBM
```
Use the path where you actually saved this project. Do not copy or reuse a `.venv` from another computer or Windows account; virtual environments contain machine-specific paths. If the project was moved, recreate `.venv` and reinstall the requirements before launching the server.

For a missing or stale environment, create a fresh one with your installed Python 3.12 executable, then install the project dependencies:
```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### Step 2: Activate the Virtual Environment
```powershell
.\.venv\Scripts\Activate.ps1
```
*(If script execution is restricted on your machine, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in the current terminal session)*.

### Step 3: Run the Regression Suite
Verify model loading, real predictions, input validation, local SVM sensitivity, metrics disclosure, PDF output, and HTTP behavior:
```powershell
.\.venv\Scripts\python.exe test_suite.py
```

### Step 4: Launch the NutriShield Application
From the project directory, start the FastAPI server:
```powershell
.\run_server.ps1
```
Keep this terminal open while using the application. Closing it stops the backend and the UI will report it as offline. Open the dashboard at `http://127.0.0.1:8000/` rather than opening `index.html` directly.

### Public demo deployment (Render)
This repository includes a Render Blueprint in `render.yaml`. Push it to GitHub, then create a Blueprint at [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints) and select the repository. The free web service may sleep when idle. Its `/tmp` SQLite database is ephemeral; screening history is not durable across service restarts or redeploys.

**Public demo only.** NutriShield has no login or access control, and screening records and APIs are available to anyone who can reach the site. Do not enter real, identifiable, or sensitive health information. The source dataset and model included in the repository are public. Use a private, appropriately secured deployment for any real screening data.

### Database and privacy
- The application has no login, registration, administrator, or password features. It opens directly to the Dashboard; all six modules and screening APIs are available without signing in.
- The default SQLite database is `data\nutrishield.sqlite3`. Set `NUTRISHIELD_DATABASE` before launch to choose another path. Records persist when the app restarts.
- Existing databases from the previous authenticated version are migrated on startup: screening records are retained, while legacy user and session tables are removed.
- All records are visible to anyone with access to the application, and there is no user-based access separation. Run the application only on a trusted local machine or behind appropriate network controls. Do not expose it publicly with identifiable or sensitive information.
- No automatic screening-record deletion or database backup is configured. Back up the database to an access-controlled location and remove backups when no longer needed. SQLite is **not encrypted at rest**; define a retention policy for any deployment.

---

## 5. Application URLs

- **NutriShield Dashboard:** [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- **Interactive Swagger Documentation:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **ReDoc API Documentation:** [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
- **Dedicated Health Check:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- **Backend health (diagnostic):** [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
- **Dataset summary:** [http://127.0.0.1:8000/api/dataset-summary](http://127.0.0.1:8000/api/dataset-summary)
- **Model performance:** [http://127.0.0.1:8000/api/model-performance](http://127.0.0.1:8000/api/model-performance)
- **Legacy diagnostic status:** [http://127.0.0.1:8000/api/status](http://127.0.0.1:8000/api/status)

When FastAPI serves the frontend, all API calls use same-origin relative URLs. If the frontend is hosted separately (e.g. VS Code Live Server on port 5500 or 5504), the client automatically defaults to `http://127.0.0.1:8000` with pre-configured development CORS support, or can be explicitly overridden via `window.NUTRISHIELD_API_BASE_URL`.

Prediction and explanation measurements are accepted with JSON `POST` requests (`/api/predict`, `/api/explain`) rather than URL query strings to avoid placing them in access-log URLs.

---

## 6. Real Model Verification Samples

These sample inputs are regression checks for the saved model, not clinical reference cases:

| Biological Sex | Age | Height | Weight | Model Output (`Detected as`) |
| :--- | :--- | :--- | :--- | :--- |
| **Male** | 5 yrs | 75.0 cm | 17.0 kg | **Stunting** |
| **Male** | 3 yrs | 106.0 cm | 9.0 kg | **Wasting** |
| **Male** | 3 yrs | 104.0 cm | 12.0 kg | **Underweight** |
| **Male** | 1 yr | 88.0 cm | 9.0 kg | **Overweight** |

---

## 7. Healthcare Safety & Clinical Disclaimer

> AI-generated results are intended for preliminary educational screening and should not replace professional medical assessment. The source dataset does not establish child-specific sampling or clinical label validity, and the saved model's independent evaluation provenance is unavailable. Reconstructed evaluation results include only one Wasting test record, making class-specific performance highly unstable. The application calculates raw BMI only; it does not apply adult BMI categories or pediatric age- and sex-specific growth references.
