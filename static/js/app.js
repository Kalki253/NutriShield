/**
 * NutriShield — Application Controller
 * Handles English-language UI, Explainable Predictions,
 * Interactive Growth Monitoring Charts, Nutrition Education, and SQLite-backed history.
 */

(function () {
  'use strict';

  function getApiBaseUrl() {
    if (window.NUTRISHIELD_API_BASE_URL) {
      return String(window.NUTRISHIELD_API_BASE_URL).replace(/\/+$/, '');
    }
    const port = window.location.port;
    const protocol = window.location.protocol;
    // If served from FastAPI on port 8000, use same-origin relative URLs
    if ((protocol === 'http:' || protocol === 'https:') && port === '8000') {
      return '';
    }
    // If served from VS Code Live Server (e.g. 5500, 5504), Vite (5173), Next (3000), or file://
    const hostname = window.location.hostname || '127.0.0.1';
    const targetHost = (hostname === 'localhost' || hostname === '127.0.0.1') ? hostname : '127.0.0.1';
    return `http://${targetHost}:8000`;
  }

  const API_BASE_URL = getApiBaseUrl();
  const API_TIMEOUT_MS = 20000;
  const MODEL_PERFORMANCE_TIMEOUT_MS = 90000;
  const HEALTH_TIMEOUT_MS = 5000;
  const MIN_SCREENING_AGE = 1;
  const MAX_SCREENING_AGE = 21;
  const OBSERVED_DATASET_AGE_MIN = 1;
  const OBSERVED_DATASET_AGE_MAX = 5;
  const NUTRIENT_FOOD_INFO = {
    iron: {
      label: 'Iron-Rich Foods',
      role: 'Iron helps the body make hemoglobin, which carries oxygen in the blood.',
      foods: ['Lentils', 'Chickpeas', 'Beans', 'Leafy green vegetables', 'Iron-fortified foods'],
      safety: "Adjust texture and size to the child's developmental stage and supervise eating. Cook legumes until soft, check food labels, and consider allergies and feeding needs."
    },
    'vitamin-a': {
      label: 'Vitamin A-Rich Foods',
      role: 'Vitamin A supports normal vision and immune-system function.',
      foods: ['Carrots', 'Pumpkin', 'Sweet potato', 'Dark green leafy vegetables', 'Eggs'],
      safety: "Offer vegetables in a soft, age-appropriate texture and supervise eating. Cook eggs thoroughly and consider allergies and feeding needs."
    },
    calcium: {
      label: 'Calcium-Rich Foods',
      role: 'Calcium helps build and maintain bones and teeth and supports normal muscle function.',
      foods: ['Milk', 'Curd', 'Cheese', 'Calcium-fortified foods'],
      safety: 'Choose pasteurized dairy and age-appropriate foods; check fortified-food labels and consider allergies and feeding needs.'
    },
    protein: {
      label: 'Protein-Rich Foods',
      role: 'Protein helps build and repair body tissues and supports growth.',
      foods: ['Lentils', 'Beans', 'Peas', 'Eggs', 'Milk and curd', 'Fish'],
      safety: "Cook legumes, eggs, and fish thoroughly; check fish carefully for bones. Adjust texture and size to the child's developmental stage, supervise eating, and consider allergies."
    },
    'vitamin-c': {
      label: 'Vitamin C-Rich Foods',
      role: 'Vitamin C supports healthy tissues and helps the body absorb iron from plant foods.',
      foods: ['Guava', 'Amla', 'Oranges', 'Tomatoes'],
      safety: 'Wash produce and offer fruit and vegetables in a soft, age-appropriate form and size. Supervise eating and consider allergies.'
    },
    folate: {
      label: 'Folate-Rich Foods',
      role: 'Folate helps cells grow and supports the formation of red blood cells.',
      foods: ['Spinach', 'Other leafy green vegetables', 'Beans', 'Peas', 'Lentils'],
      safety: "Wash vegetables and cook leafy greens and legumes as appropriate. Adjust texture and size to the child's developmental stage, supervise eating, and consider allergies."
    }
  };
  const NUTRITION_GUIDANCE = {
    Overweight: {
      groups: [
        { title: 'Whole grains', foods: ['Oats', 'Whole-wheat chapati', 'Other suitable grains'], explanation: 'Grains can be part of regular, balanced meals.', image: '/static/foods/grains.svg', alt: 'Illustration of grain foods' },
        { title: 'Vegetables', foods: ['Carrots', 'Beans', 'Spinach', 'Pumpkin', 'Seasonal vegetables'], explanation: 'Offer a variety of vegetables in forms suitable for the child.', image: '/static/foods/vegetables.svg', alt: 'Illustration of colorful vegetables' },
        { title: 'Fruits', foods: ['Guava', 'Papaya', 'Oranges', 'Other seasonal fruits'], explanation: 'Offer a variety of washed, age-appropriate fruits.', image: '/static/foods/fruits.svg', alt: 'Illustration of fresh fruit' },
        { title: 'Protein sources', foods: ['Dal', 'Beans', 'Peas', 'Eggs', 'Fish', 'Milk', 'Curd'], explanation: 'Include suitable protein foods as part of varied meals.', image: '/static/foods/protein.svg', alt: 'Illustration of protein-rich foods' },
        { title: 'Healthy fats', foods: ['Suitable nuts', 'Seeds', 'Other age-appropriate sources'], explanation: 'Choose safe forms and textures; whole nuts can be a choking hazard for young children.', image: '/static/foods/healthy-fats.svg', alt: 'Illustration of nuts and seeds' }
      ],
      habits: ['Encourage regular, balanced meals.', 'Offer a variety of fruits and vegetables.', 'Prefer water as a regular drink.', 'Limit frequent sugary drinks and highly processed snacks without shaming or restricting meals.', 'Encourage enjoyable physical activity and adequate sleep appropriate for the child’s age.']
    },
    Underweight: {
      groups: [
        { title: 'Grains and staple foods', foods: ['Oats', 'Rice', 'Whole-wheat chapati', 'Other suitable grains'], explanation: 'Offer familiar staple foods as part of regular, varied meals.', image: '/static/foods/grains.svg', alt: 'Illustration of grain foods' },
        { title: 'Protein foods', foods: ['Dal', 'Lentils', 'Beans', 'Peas', 'Eggs', 'Fish'], explanation: 'A mix of suitable plant and animal protein foods can add variety to meals.', image: '/static/foods/protein.svg', alt: 'Illustration of protein-rich foods' },
        { title: 'Milk and other dairy foods', foods: ['Milk', 'Curd', 'Cheese'], explanation: 'Offer age-appropriate dairy foods if they suit the child and family diet.', image: '/static/foods/dairy.svg', alt: 'Illustration of milk and dairy foods' },
        { title: 'Fruits and vegetables', foods: ['Seasonal fruits', 'Carrots', 'Spinach', 'Pumpkin', 'Other seasonal vegetables'], explanation: 'Different colors and types help make meals varied.', image: '/static/foods/vegetables.svg', alt: 'Illustration of fruits and vegetables' }
      ],
      habits: ['Offer regular meals and snacks suitable for the child’s age and family routine.', 'Make mealtimes calm and supportive; avoid pressure or comparisons.', 'Offer water regularly and a variety of familiar foods.', 'Discuss growth concerns with a qualified pediatric healthcare professional or dietitian.']
    },
    Stunting: {
      groups: [
        { title: 'Grains and staple foods', foods: ['Oats', 'Rice', 'Whole-wheat chapati', 'Other suitable grains'], explanation: 'Staple foods can be offered alongside other food groups in varied meals.', image: '/static/foods/grains.svg', alt: 'Illustration of grain foods' },
        { title: 'Protein foods', foods: ['Dal', 'Beans', 'Peas', 'Eggs', 'Fish', 'Milk', 'Curd'], explanation: 'Suitable protein foods can be included as part of a varied family diet.', image: '/static/foods/protein.svg', alt: 'Illustration of protein-rich foods' },
        { title: 'Fruits and vegetables', foods: ['Guava', 'Papaya', 'Carrots', 'Spinach', 'Pumpkin', 'Seasonal produce'], explanation: 'Offer different washed fruits and vegetables in safe, age-appropriate forms.', image: '/static/foods/fruits.svg', alt: 'Illustration of fruits and vegetables' }
      ],
      habits: ['Offer regular, varied meals that suit the child’s age and feeding stage.', 'Make mealtimes supportive and responsive to the child.', 'Seek professional assessment for growth concerns; child growth must be interpreted using suitable age- and sex-specific standards.']
    },
    Wasting: {
      groups: [
        { title: 'Grains and staple foods', foods: ['Oats', 'Rice', 'Whole-wheat chapati', 'Other suitable grains'], explanation: 'Offer suitable staple foods as part of regular, varied meals.', image: '/static/foods/grains.svg', alt: 'Illustration of grain foods' },
        { title: 'Protein foods', foods: ['Dal', 'Lentils', 'Beans', 'Peas', 'Eggs', 'Fish'], explanation: 'Choose safe, age-appropriate foods from the family’s usual diet.', image: '/static/foods/protein.svg', alt: 'Illustration of protein-rich foods' },
        { title: 'Fruits and vegetables', foods: ['Papaya', 'Guava', 'Carrots', 'Pumpkin', 'Seasonal vegetables'], explanation: 'A variety of washed produce can be offered in safe forms and textures.', image: '/static/foods/vegetables.svg', alt: 'Illustration of fruits and vegetables' }
      ],
      habits: ['Keep mealtimes calm and offer familiar, age-appropriate foods.', 'Do not force food or use restrictive diets based on a model output.', 'Contact a qualified pediatric healthcare professional or dietitian for concerns about growth, appetite, or feeding.']
    }
  };

  // Global Application State
  const state = {
    currentView: 'dashboard',
    selectedSex: 'male',
    monitoringRecords: [],
    lastPrediction: null,
    editingRecordId: null,
    modelMetrics: null,
    datasetSummary: null,
    performanceRequest: null,
    batchResult: null,
    batchCurrentPage: 1,
    batchPageSize: 100,
    batchSortKey: 'row_number',
    batchSortDirection: 'asc',
    backendStatus: {
      online: null,
      modelLoaded: false,
      datasetAvailable: false,
      request: null
    }
  };

  const el = {};

  function initElements() {
    el.sidebar = document.getElementById('sidebar');
    el.sidebarBackdrop = document.getElementById('sidebarBackdrop');
    el.sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    el.sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    el.navLinks = document.querySelectorAll('.nav-item');
    el.viewSections = document.querySelectorAll('.view-section');
    el.pageTitle = document.getElementById('pageTitle');
    el.sessionCountPill = document.getElementById('sessionCountPill');
    el.sidebarStatusDot = document.getElementById('sidebarStatusDot');
    el.sidebarStatusLabel = document.getElementById('sidebarStatusLabel');
    el.retryBackendBtn = document.getElementById('retryBackendBtn');

    // Dashboard Elements
    el.dashModelStatus = document.getElementById('dashModelStatus');
    el.dashModelStatusDetail = document.getElementById('dashModelStatusDetail');
    el.dashSessionTotal = document.getElementById('dashSessionTotal');
    el.dashRecentHistoryTable = document.getElementById('dashRecentHistoryTable');
    el.metricsNotice = document.getElementById('metricsNotice');
    el.metricsReason = document.getElementById('metricsReason');
    el.evaluationMethodology = document.getElementById('evaluationMethodology');
    el.evaluationLimitations = document.getElementById('evaluationLimitations');
    el.retryMetricsBtn = document.getElementById('retryMetricsBtn');
    el.downloadMetricsReportBtn = document.getElementById('downloadMetricsReportBtn');
    el.metricAccuracy = document.getElementById('metricAccuracy');
    el.metricPrecision = document.getElementById('metricPrecision');
    el.metricRecall = document.getElementById('metricRecall');
    el.metricF1 = document.getElementById('metricF1');
    el.metricF1Weighted = document.getElementById('metricF1Weighted');
    el.modelComparisonSummary = document.getElementById('modelComparisonSummary');
    el.modelComparisonChart = document.getElementById('modelComparisonChart');
    el.classificationReportContainer = document.getElementById('classificationReportContainer');
    el.targetCountsChart = document.getElementById('targetCountsChart');
    el.datasetCountsSummary = document.getElementById('datasetCountsSummary');
    el.confusionMatrixStatus = document.getElementById('confusionMatrixStatus');
    el.confusionMatrixContainer = document.getElementById('confusionMatrixContainer');

    // Prediction Form Elements
    el.predictionForm = document.getElementById('predictionForm');
    el.sexMaleBtn = document.getElementById('sexMaleBtn');
    el.sexFemaleBtn = document.getElementById('sexFemaleBtn');
    el.inputAge = document.getElementById('inputAge');
    el.inputHeight = document.getElementById('inputHeight');
    el.inputWeight = document.getElementById('inputWeight');
    el.inputChildCode = document.getElementById('inputChildCode');
    el.liveBmiDisplay = document.getElementById('liveBmiDisplay');
    el.predictSubmitBtn = document.getElementById('predictSubmitBtn');
    el.predictAlert = document.getElementById('predictAlert');

    // Batch prediction elements
    el.batchFileInput = document.getElementById('batchFileInput');
    el.batchFileName = document.getElementById('batchFileName');
    el.batchUploadBtn = document.getElementById('batchUploadBtn');
    el.downloadBatchTemplateBtn = document.getElementById('downloadBatchTemplateBtn');
    el.batchUploadProgress = document.getElementById('batchUploadProgress');
    el.batchStatus = document.getElementById('batchStatus');
    el.batchResults = document.getElementById('batchResults');
    el.batchDenominatorNote = document.getElementById('batchDenominatorNote');
    el.batchTotalRecords = document.getElementById('batchTotalRecords');
    el.batchValidRecords = document.getElementById('batchValidRecords');
    el.batchRejectedRecords = document.getElementById('batchRejectedRecords');
    el.batchDuplicateRecords = document.getElementById('batchDuplicateRecords');
    el.batchDistributionChart = document.getElementById('batchDistributionChart');
    el.batchDistributionLegend = document.getElementById('batchDistributionLegend');
    el.batchDownloadCsvBtn = document.getElementById('batchDownloadCsvBtn');
    el.batchDownloadValidationBtn = document.getElementById('batchDownloadValidationBtn');
    el.batchDownloadSummaryBtn = document.getElementById('batchDownloadSummaryBtn');
    el.batchSearchInput = document.getElementById('batchSearchInput');
    el.batchClassFilter = document.getElementById('batchClassFilter');
    el.batchResultsHead = document.getElementById('batchResultsHead');
    el.batchResultsBody = document.getElementById('batchResultsBody');
    el.batchPageSummary = document.getElementById('batchPageSummary');
    el.batchPreviousPageBtn = document.getElementById('batchPreviousPageBtn');
    el.batchNextPageBtn = document.getElementById('batchNextPageBtn');
    el.batchValidationSummary = document.getElementById('batchValidationSummary');
    el.batchRejectedRowsBody = document.getElementById('batchRejectedRowsBody');

    // Result & Explainability Elements
    el.resultPlaceholder = document.getElementById('resultPlaceholder');
    el.resultDisplayCard = document.getElementById('resultDisplayCard');
    el.resultBody = el.resultDisplayCard && el.resultDisplayCard.querySelector('.result-body');
    el.openNutritionGuidanceBtn = document.getElementById('openNutritionGuidanceBtn');
    el.predictionNutritionGuidance = document.getElementById('predictionNutritionGuidance');
    el.batchNutritionGuidance = document.getElementById('batchNutritionGuidance');
    el.resultBadge = document.getElementById('resultBadge');
    el.resultExplanationBox = document.getElementById('resultExplanationBox');
    el.ageValidationNotice = document.getElementById('ageValidationNotice');
    el.resSummarySex = document.getElementById('resSummarySex');
    el.resSummaryAge = document.getElementById('resSummaryAge');
    el.resSummaryHeight = document.getElementById('resSummaryHeight');
    el.resSummaryWeight = document.getElementById('resSummaryWeight');
    el.resSummaryBmi = document.getElementById('resSummaryBmi');
    el.resSummaryTimestamp = document.getElementById('resSummaryTimestamp');
    el.newPredictionBtn = document.getElementById('newPredictionBtn');
    el.saveHistoryBtn = document.getElementById('saveHistoryBtn');
    el.saveHistoryStatus = document.getElementById('saveHistoryStatus');
    el.downloadReportBtn = document.getElementById('downloadReportBtn');
    el.speakResultBtn = document.getElementById('speakResultBtn');
    el.voiceStatus = document.getElementById('voiceStatus');
    el.reportStatus = document.getElementById('reportStatus');

    // Explainability Specific UI elements
    el.expRationaleText = document.getElementById('expRationaleText');
    el.expFeatureList = document.getElementById('expFeatureList');
    el.nextStepsGuidanceBox = document.getElementById('nextStepsGuidanceBox');

    // Monitoring & Charts Elements
    el.weightChartSvg = document.getElementById('weightChartSvg');
    el.bmiChartSvg = document.getElementById('bmiChartSvg');
    el.summaryChartSvg = document.getElementById('summaryChartSvg');
    el.historyTableBody = document.getElementById('historyTableBody');
    el.clearHistoryBtn = document.getElementById('clearHistoryBtn');
    el.exportCsvBtn = document.getElementById('exportCsvBtn');
    el.historyFilterSelect = document.getElementById('historyFilterSelect');
    el.historySearchInput = document.getElementById('historySearchInput');
    el.historyStorageStatus = document.getElementById('historyStorageStatus');

    // Nutrition Education Elements
  }

  // ============================================================================
  // Apply the single supported language to static interface labels.
  // ============================================================================
  function applyEnglishText() {
    const dict = TRANSLATIONS.en;

    // Translate DOM nodes with data-i18n attributes
    document.querySelectorAll('[data-i18n]').forEach(elem => {
      const key = elem.getAttribute('data-i18n');
      if (dict[key]) {
        elem.textContent = dict[key];
      }
    });

    // Translate placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(elem => {
      const key = elem.getAttribute('data-i18n-placeholder');
      if (dict[key]) {
        elem.setAttribute('placeholder', dict[key]);
      }
    });

    // Update current page title
    updateCurrentPageTitle();
    if (state.backendStatus.online !== null) {
      updateStatusUI({
        backend_online: state.backendStatus.online,
        model_loaded: state.backendStatus.modelLoaded,
        dataset_available: state.backendStatus.datasetAvailable
      });
    }

    // Re-render history and monitoring tables
    updateMonitoringUI();
    renderModelMetrics();
    if (state.lastPrediction) displayExplainableResult(state.lastPrediction, false);
  }

  function updateCurrentPageTitle() {
    const dict = TRANSLATIONS.en;
    const titleMap = {
      dashboard: dict.navDashboard,
      predict: dict.navNewAssessment,
      batch: dict.navBatchPrediction,
      performance: dict.navPerformance,
      monitoring: dict.navMonitoring,
      education: dict.navNutritionEdu
    };
    if (el.pageTitle) {
      el.pageTitle.textContent = titleMap[state.currentView] || dict.appName;
    }
  }

  // ============================================================================
  // Navigation & View Routing
  // ============================================================================
  function switchView(targetViewId) {
    state.currentView = targetViewId;

    el.navLinks.forEach(link => {
      const view = link.getAttribute('data-view');
      link.classList.toggle('active', view === targetViewId);
    });

    el.viewSections.forEach(section => {
      const sectionId = section.id.replace('-view', '');
      section.classList.toggle('active', sectionId === targetViewId);
    });

    updateCurrentPageTitle();
    closeMobileSidebar(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.location.hash = targetViewId;

    if (targetViewId === 'monitoring') {
      renderGrowthCharts();
    }
  }

  function setupNavigation() {
    el.navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(link.getAttribute('data-view'));
      });
    });

    document.querySelectorAll('[data-goto-view]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(btn.getAttribute('data-goto-view'));
      });
    });

    if (el.sidebarToggleBtn) el.sidebarToggleBtn.addEventListener('click', openMobileSidebar);
    if (el.sidebarCloseBtn) el.sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
    if (el.sidebarBackdrop) el.sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    if (el.retryBackendBtn) el.retryBackendBtn.addEventListener('click', onRetryBackendClick);

    const hash = window.location.hash.replace('#', '');
    if (['dashboard', 'predict', 'batch', 'performance', 'monitoring', 'education'].includes(hash)) {
      switchView(hash);
    } else {
      switchView('dashboard');
    }

    window.addEventListener('hashchange', () => {
      const newHash = window.location.hash.replace('#', '');
      if (['dashboard', 'predict', 'batch', 'performance', 'monitoring', 'education'].includes(newHash) &&
          newHash !== state.currentView) {
        switchView(newHash);
      }
    });
    updateSidebarAccessibility();
    window.addEventListener('resize', updateSidebarAccessibility);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && el.sidebar && el.sidebar.classList.contains('open')) {
        closeMobileSidebar();
      }
    });
  }

  function openMobileSidebar() {
    if (el.sidebar) {
      el.sidebar.classList.add('open');
      el.sidebar.removeAttribute('inert');
      el.sidebar.removeAttribute('aria-hidden');
    }
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add('active');
    if (el.sidebarToggleBtn) el.sidebarToggleBtn.setAttribute('aria-expanded', 'true');
    if (el.sidebarCloseBtn) el.sidebarCloseBtn.focus();
  }

  function closeMobileSidebar(restoreFocus = true) {
    if (el.sidebar) {
      el.sidebar.classList.remove('open');
      if (window.innerWidth <= 992) {
        el.sidebar.setAttribute('inert', '');
        el.sidebar.setAttribute('aria-hidden', 'true');
      }
    }
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.remove('active');
    if (el.sidebarToggleBtn) el.sidebarToggleBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus && window.innerWidth <= 992 && el.sidebarToggleBtn) el.sidebarToggleBtn.focus();
  }

  function updateSidebarAccessibility() {
    if (!el.sidebar) return;
    if (window.innerWidth <= 992 && !el.sidebar.classList.contains('open')) {
      el.sidebar.setAttribute('inert', '');
      el.sidebar.setAttribute('aria-hidden', 'true');
    } else {
      el.sidebar.removeAttribute('inert');
      el.sidebar.removeAttribute('aria-hidden');
      if (window.innerWidth > 992) {
        el.sidebar.classList.remove('open');
        if (el.sidebarBackdrop) el.sidebarBackdrop.classList.remove('active');
        if (el.sidebarToggleBtn) el.sidebarToggleBtn.setAttribute('aria-expanded', 'false');
      }
    }
  }

  // ============================================================================
  // Backend Diagnostics & Status
  // ============================================================================
  async function fetchWithTimeout(path, options = {}) {
    const timeoutMs = options.timeoutMs || API_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const baseUrl = getApiBaseUrl();
    const requestHeaders = new Headers(options.headers || {});
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: requestHeaders,
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutErr = new Error(`The request timed out after ${timeoutMs / 1000} seconds.`);
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      if (error instanceof TypeError || (error.message && (error.message.includes('fetch') || error.message.includes('NetworkError')))) {
        const netErr = new Error('The backend could not be reached. Check the server address and connection.');
        netErr.name = 'NetworkError';
        throw netErr;
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function requestJson(path, options = {}, allowHttpError = false) {
    const response = await fetchWithTimeout(path, options);
    let data;
    try {
      data = await response.json();
    } catch (error) {
      const invalidErr = new Error(`The backend returned an invalid response (${response.status}).`);
      invalidErr.name = 'InvalidResponseError';
      invalidErr.status = response.status;
      throw invalidErr;
    }

    if (!response.ok && !allowHttpError) {
      const detail = data.detail || data.error || data.reason || `Request failed (${response.status}).`;
      const requestError = new Error(Array.isArray(detail) ? detail.map(issue => issue.msg).join(' ') : detail);
      requestError.status = response.status;
      requestError.payload = data;
      throw requestError;
    }
    return { response, data };
  }

  function classifyBackendError(error, response = null) {
    const dict = TRANSLATIONS.en;
    if (error.name === 'TimeoutError' || (error.message && error.message.includes('timed out'))) {
      return {
        type: 'timeout',
        label: 'Timeout',
        message: dict.timeoutDetail || 'Health check timed out. FastAPI server took too long to respond.'
      };
    }
    if (error.name === 'NetworkError' || (error.message && (error.message.includes('not be reached') || error.message.includes('Failed to fetch') || error.message.includes('Network')))) {
      return {
        type: 'network',
        label: dict.backendOffline,
        message: dict.networkErrorDetail || 'FastAPI server did not respond on port 8000; status will be checked again automatically.'
      };
    }
    if ((response && response.status === 503) || (error.status === 503)) {
      return {
        type: 'model_unavailable',
        label: dict.modelUnavailable,
        message: dict.modelUnavailableDetail || 'The backend is connected, but the saved model is unavailable.'
      };
    }
    if ((response && response.status >= 500) || (error.status >= 500)) {
      return {
        type: 'server_error',
        label: 'Server Error',
        message: dict.serverErrorDetail || 'Server-side error (500). Please check FastAPI terminal logs.'
      };
    }
    if (error.name === 'InvalidResponseError' || error.name === 'SyntaxError') {
      return {
        type: 'invalid_response',
        label: 'Invalid Response',
        message: dict.invalidResponseDetail || 'The backend returned an invalid or unparseable response.'
      };
    }
    return {
      type: 'offline',
      label: dict.backendOffline,
      message: error.message || dict.backendOfflineDetail
    };
  }

  let healthCheckTimer = null;
  let lastHealthCheckTime = 0;
  let consecutiveFailures = 0;

  function scheduleNextHealthCheck(delayMs) {
    if (healthCheckTimer) {
      clearTimeout(healthCheckTimer);
      healthCheckTimer = null;
    }
    healthCheckTimer = window.setTimeout(() => {
      fetchBackendStatus();
    }, delayMs);
  }

  function onRetryBackendClick() {
    if (healthCheckTimer) {
      clearTimeout(healthCheckTimer);
      healthCheckTimer = null;
    }
    consecutiveFailures = 0;
    fetchBackendStatus();
  }

  async function fetchBackendStatus(isRetryAttempt = false) {
    if (state.backendStatus.request) return state.backendStatus.request;

    state.backendStatus.request = (async () => {
      if (el.retryBackendBtn) el.retryBackendBtn.disabled = true;
      try {
        // Dedicated lightweight /health endpoint with 5000ms timeout
        const { response, data } = await requestJson('/health', { timeoutMs: HEALTH_TIMEOUT_MS }, true);

        if (!data || typeof data !== 'object') {
          throw new Error('The backend returned an invalid response.');
        }

        const isFastApi = data.api === 'FastAPI' || data.status === 'online' || data.backend_online === true;
        const modelReady = data.model_loaded === true;

        if (!isFastApi) {
          throw new Error('Invalid response: not a FastAPI backend.');
        }

        // Backend is online! Reset failure counter
        consecutiveFailures = 0;
        state.backendStatus.online = true;
        state.backendStatus.modelLoaded = modelReady;
        state.backendStatus.datasetAvailable = data.dataset_available !== false;
        state.backendStatus.errorType = modelReady ? null : 'model_unavailable';
        state.backendStatus.errorMessage = null;
        state.backendStatus.lastChecked = Date.now();
        lastHealthCheckTime = Date.now();

        updateStatusUI({
          backend_online: true,
          model_loaded: modelReady,
          dataset_available: data.dataset_available !== false,
          status: data.status || (modelReady ? 'online' : 'degraded')
        });

        // Schedule next routine poll in 30 seconds
        scheduleNextHealthCheck(30000);
      } catch (error) {
        console.warn('Backend health check attempt failed:', error);

        // Transient failure protection: if previously online, retry once quickly after 1s before marking offline
        if (!isRetryAttempt && consecutiveFailures === 0 && state.backendStatus.online === true) {
          consecutiveFailures++;
          state.backendStatus.request = null;
          window.setTimeout(() => fetchBackendStatus(true), 1000);
          return;
        }

        consecutiveFailures++;
        const classified = classifyBackendError(error);
        state.backendStatus.online = false;
        state.backendStatus.modelLoaded = false;
        state.backendStatus.datasetAvailable = false;
        state.backendStatus.errorType = classified.type;
        state.backendStatus.errorMessage = classified.message;
        state.backendStatus.lastChecked = Date.now();
        lastHealthCheckTime = Date.now();

        updateStatusUI({
          backend_online: false,
          model_loaded: false,
          dataset_available: false,
          error: classified
        });

        // Adaptive polling with sensible backoff (10s up to 30s) to stop excessive requests
        const nextDelay = Math.min(30000, 10000 * Math.min(consecutiveFailures, 3));
        scheduleNextHealthCheck(nextDelay);
      } finally {
        if (el.retryBackendBtn) el.retryBackendBtn.disabled = false;
        state.backendStatus.request = null;
      }
    })();

    return state.backendStatus.request;
  }

  function updateStatusUI(data) {
    const backendOnline = data.backend_online === true;
    const modelReady = backendOnline && data.model_loaded === true;
    const datasetReady = backendOnline && data.dataset_available !== false;
    const dependenciesReady = modelReady && datasetReady;
    const dict = TRANSLATIONS.en;

    let statusText;
    let details;

    if (!backendOnline) {
      const err = data.error || {};
      statusText = err.label || dict.backendOffline;
      details = err.message || dict.backendOfflineDetail;
    } else if (!modelReady) {
      statusText = dict.modelUnavailable;
      details = dict.modelUnavailableDetail;
    } else if (!datasetReady) {
      statusText = dict.datasetUnavailable;
      details = dict.datasetUnavailableDetail;
    } else {
      statusText = dict.modelReady;
      details = dict.backendReadyDetail;
    }

    if (el.sidebarStatusDot) {
      el.sidebarStatusDot.classList.toggle('degraded', backendOnline && !dependenciesReady);
      el.sidebarStatusDot.classList.toggle('connection-offline', !backendOnline);
      el.sidebarStatusDot.classList.toggle('dataset-unavailable', backendOnline && !datasetReady);
    }
    if (el.sidebarStatusLabel) el.sidebarStatusLabel.textContent = statusText;

    if (el.dashModelStatus) {
      el.dashModelStatus.textContent = statusText;
      el.dashModelStatus.style.color = dependenciesReady ? '#17653a' : !backendOnline ? '#b42318' : '#92400e';
    }
    if (el.dashModelStatusDetail) el.dashModelStatusDetail.textContent = details;
  }

  async function fetchModelMetrics() {
    if (state.performanceRequest) return state.performanceRequest;
    if (el.metricsNotice) el.metricsNotice.setAttribute('aria-busy', 'true');
    if (el.retryMetricsBtn) el.retryMetricsBtn.disabled = true;

    state.performanceRequest = (async () => {
      try {
        const results = await Promise.all([
          requestJson('/api/model-performance', { timeoutMs: MODEL_PERFORMANCE_TIMEOUT_MS }, true)
            .then(result => ({ result }))
            .catch(error => ({ error })),
          requestJson('/api/dataset-summary', {}, true)
            .then(result => ({ result }))
            .catch(error => ({ error }))
        ]);
        const [performanceResult, datasetResult] = results;

        state.modelMetrics = performanceResult.result
          ? performanceResult.result.data
          : {
            available: false,
            reason_code: 'evaluation_service_unavailable',
            reason: performanceResult.error.message,
            dataset_available: false,
            metrics: null,
            confusion_matrix: null
          };
        state.datasetSummary = datasetResult.result
          ? datasetResult.result.data
          : state.modelMetrics.dataset_summary || {
            available: false,
            reason: datasetResult.error.message
          };

        if (performanceResult.error) console.error('Model performance could not be loaded:', performanceResult.error);
        if (datasetResult.error) console.error('Dataset summary could not be loaded:', datasetResult.error);
        renderModelMetrics();
      } finally {
        if (el.retryMetricsBtn) el.retryMetricsBtn.disabled = false;
        if (el.metricsNotice) el.metricsNotice.setAttribute('aria-busy', 'false');
        state.performanceRequest = null;
      }
    })();
    return state.performanceRequest;
  }

  async function downloadEvaluationReport() {
    if (!el.downloadMetricsReportBtn) return;
    el.downloadMetricsReportBtn.disabled = true;
    try {
      const report = {
        generated_at: new Date().toISOString(),
        evaluation: state.modelMetrics,
        dataset_summary: state.datasetSummary,
        disclaimer: 'Metrics describe reconstructed candidates and are not verified performance results for the saved deployment model.'
      };
      downloadBatchBlob(
        `nutrishield_evaluation_${new Date().toISOString().slice(0, 10)}.json`,
        new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      );
    } catch (error) {
      console.error('Evaluation report could not be downloaded:', error);
      alert(`Evaluation report could not be downloaded: ${error.message}`);
    } finally {
      el.downloadMetricsReportBtn.disabled = false;
    }
  }

  function formatEvaluationMethodology(methodology) {
    if (!methodology) return '';
    const parts = [
      methodology.dataset_split,
      `Random seed ${methodology.random_seed}`,
      `${methodology.train_rows} training rows and ${methodology.test_rows} test rows`,
      methodology.cross_validation,
      `Training pipeline: ${methodology.training_pipeline}`
    ].filter(Boolean);
    const parameters = methodology.best_parameters;
    if (parameters) {
      parts.push(`Selected parameters: ${Object.entries(parameters).map(([key, value]) => `${key}=${value}`).join(', ')}`);
    }
    return parts.join('. ');
  }

  function formatEvaluationLimitations(methodology, modelComparison) {
    const limitations = [];
    if (methodology && methodology.grouping_unit) limitations.push(`Grouping limitation: ${methodology.grouping_unit}`);
    if (methodology && methodology.rare_test_classes && Object.keys(methodology.rare_test_classes).length > 0) {
      limitations.push(`Few test examples: ${Object.entries(methodology.rare_test_classes).map(([label, count]) => `${label} (${count})`).join(', ')}`);
    }
    if (methodology && methodology.limitations) limitations.push(methodology.limitations);
    if (modelComparison && modelComparison.deployed_model && modelComparison.deployed_model_changed === false) {
      limitations.push(`The saved deployment model (${modelComparison.deployed_model}) was not changed; its training provenance is unverified, so these metrics are not attributed to it.`);
    }
    return limitations.map(item => `${item.replace(/[.\s]+$/, '')}.`).join(' ');
  }

  function renderModelMetrics() {
    if (!el.metricsNotice) return;
    const dict = TRANSLATIONS.en;
    const data = state.modelMetrics;
    if (!data) return;

    const summary = state.datasetSummary || data.dataset_summary;
    const metricsAvailable = data.available === true && data.metrics && typeof data.metrics === 'object';
    const reason = data.reason_code === 'evaluation_service_unavailable'
      ? data.reason || dict.metricsServiceUnavailable
      : !summary || summary.available !== true
        ? 'Evaluation is unavailable because the source dataset could not be loaded. See the dataset section for details.'
        : data.reason || dict.metricsServiceUnavailable;
    if (el.metricsReason) el.metricsReason.textContent = metricsAvailable ? 'Evaluation metrics are available.' : reason;
    if (el.evaluationMethodology) {
      el.evaluationMethodology.textContent = formatEvaluationMethodology(data.evaluation_methodology) || dict.metricsUnavailable;
    }
    if (el.evaluationLimitations) {
      el.evaluationLimitations.textContent = formatEvaluationLimitations(data.evaluation_methodology, data.model_comparison) || dict.metricsUnavailable;
    }
    el.metricsNotice.setAttribute('aria-busy', 'false');

    [
      [el.metricAccuracy, 'accuracy'],
      [el.metricPrecision, 'precision_macro'],
      [el.metricRecall, 'recall_macro'],
      [el.metricF1, 'f1_macro'],
      [el.metricF1Weighted, 'f1_weighted']
    ].forEach(([element, key]) => {
      const value = metricsAvailable ? Number(data.metrics[key]) : NaN;
      if (element) element.textContent = Number.isFinite(value)
        ? `${(value * 100).toFixed(1)}%`
        : dict.metricsUnavailable;
    });

    const confusionAvailable = Array.isArray(data.confusion_matrix) && Array.isArray(data.classes);
    if (el.confusionMatrixStatus) {
      el.confusionMatrixStatus.textContent = confusionAvailable
        ? dict.confusionMatrixAvailable
        : 'No valid held-out test predictions are available.';
    }
    renderConfusionMatrix(confusionAvailable ? data.confusion_matrix : null, confusionAvailable ? data.classes : []);
    renderModelComparison(data.model_comparison);
    renderClassificationReport(data.class_metrics, data.classes);

    if (summary && summary.available === true) {
      const missingLabelText = summary.missing_target_rows > 0
        ? ` ${summary.missing_target_rows} rows with missing labels were excluded.`
        : '';
      if (el.datasetCountsSummary) {
        el.datasetCountsSummary.textContent = `${summary.labeled_rows} labeled records from ${summary.total_rows} rows. Target column: ${summary.target_column}.${missingLabelText}`;
      }
      renderTargetCountsChart(summary.class_counts || {});
    } else {
      if (el.datasetCountsSummary) {
        el.datasetCountsSummary.textContent = summary && summary.reason
          ? `Dataset target-label counts unavailable: ${summary.reason}`
          : dict.metricsDatasetUnavailable;
      }
      renderTargetCountsChart({});
    }
  }

  function renderModelComparison(comparison) {
    if (el.modelComparisonSummary) {
      el.modelComparisonSummary.textContent = comparison
        ? `Selected candidate by ${comparison.selection_metric}: ${comparison.best_candidate.replaceAll('_', ' ')}.`
        : 'No reconstructed candidate comparison is available.';
    }
    if (!el.modelComparisonChart) return;
    el.modelComparisonChart.replaceChildren();
    if (!comparison || !comparison.candidates) return;
    const entries = Object.entries(comparison.candidates);
    const width = 560;
    const rowHeight = 38;
    const height = Math.max(100, entries.length * rowHeight + 30);
    const maxValue = 1;
    entries.forEach(([name, metrics], index) => {
      const y = 16 + index * rowHeight;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', String(y + 16));
      label.setAttribute('font-size', '12');
      label.setAttribute('fill', '#334155');
      label.textContent = name.replaceAll('_', ' ');
      const value = Number(metrics.f1_macro);
      const ratio = Number.isFinite(value) ? Math.max(0, Math.min(1, value / maxValue)) : 0;
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bar.setAttribute('x', '175');
      bar.setAttribute('y', String(y));
      bar.setAttribute('width', String(ratio * 300));
      bar.setAttribute('height', '22');
      bar.setAttribute('rx', '4');
      bar.setAttribute('fill', '#138a83');
      const score = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      score.setAttribute('x', String(185 + ratio * 300));
      score.setAttribute('y', String(y + 16));
      score.setAttribute('font-size', '12');
      score.setAttribute('fill', '#1f2937');
      score.textContent = Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unavailable';
      el.modelComparisonChart.append(label, bar, score);
    });
    el.modelComparisonChart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  function renderClassificationReport(classMetrics, classes) {
    if (!el.classificationReportContainer) return;
    el.classificationReportContainer.replaceChildren();
    if (!classMetrics || !Array.isArray(classes)) return;
    const table = document.createElement('table');
    table.className = 'classification-report-table';
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Class', 'Precision', 'Recall', 'F1', 'Support'].forEach(label => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headerRow.appendChild(cell);
    });
    head.appendChild(headerRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    classes.forEach(label => {
      const values = classMetrics[label];
      if (!values) return;
      const row = document.createElement('tr');
      [label, values.precision, values.recall, values.f1, values.support].forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = index === 0
          ? String(value)
          : index === 4 ? String(value) : `${(Number(value) * 100).toFixed(1)}%`;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    el.classificationReportContainer.appendChild(table);
  }

  function renderConfusionMatrix(matrix, classes) {
    if (!el.confusionMatrixContainer) return;
    el.confusionMatrixContainer.replaceChildren();
    if (!matrix || !classes.length || matrix.length !== classes.length) return;

    const table = document.createElement('table');
    table.className = 'data-table confusion-matrix';
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    ['Actual \\ Predicted', ...classes].forEach(label => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headingRow.appendChild(cell);
    });
    head.appendChild(headingRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    matrix.forEach((row, index) => {
      const tableRow = document.createElement('tr');
      const rowMaximum = Math.max(1, ...row.map(value => Number(value)));
      const rowLabel = document.createElement('th');
      rowLabel.scope = 'row';
      rowLabel.textContent = classes[index];
      tableRow.appendChild(rowLabel);
      row.forEach((value, columnIndex) => {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        const intensity = Math.max(0, Math.min(1, Number(value) / rowMaximum));
        cell.style.backgroundColor = `rgba(19, 138, 131, ${0.08 + intensity * 0.62})`;
        cell.title = `Actual ${classes[index]}, predicted ${classes[columnIndex]}: ${value}`;
        tableRow.appendChild(cell);
      });
      body.appendChild(tableRow);
    });
    table.appendChild(body);
    el.confusionMatrixContainer.appendChild(table);
  }

  function renderTargetCountsChart(classCounts) {
    if (!el.targetCountsChart) return;
    const namespace = 'http://www.w3.org/2000/svg';
    const entries = Object.entries(classCounts);
    const dict = TRANSLATIONS.en;
    el.targetCountsChart.replaceChildren();
    const title = document.createElementNS(namespace, 'title');
    title.id = 'targetCountsChartTitle';
    title.textContent = dict.targetCountsTitle;
    const description = document.createElementNS(namespace, 'desc');
    description.id = 'targetCountsChartDescription';
    description.textContent = dict.targetCountsDescription;
    el.targetCountsChart.append(title, description);
    if (entries.length === 0) {
      el.targetCountsChart.setAttribute('viewBox', '0 0 560 120');
      return;
    }

    const width = 560;
    const rowHeight = 42;
    const height = entries.length * rowHeight + 20;
    const maxCount = Math.max(...entries.map(([, count]) => Number(count)));
    entries.forEach(([label, count], index) => {
      const y = 16 + index * rowHeight;
      const labelText = document.createElementNS(namespace, 'text');
      labelText.setAttribute('x', '8');
      labelText.setAttribute('y', String(y + 17));
      labelText.setAttribute('fill', '#1f2937');
      labelText.setAttribute('font-size', '13');
      labelText.textContent = `${label} (${count})`;

      const background = document.createElementNS(namespace, 'rect');
      background.setAttribute('x', '170');
      background.setAttribute('y', String(y));
      background.setAttribute('width', '320');
      background.setAttribute('height', '24');
      background.setAttribute('rx', '4');
      background.setAttribute('fill', '#dce4ee');

      const bar = document.createElementNS(namespace, 'rect');
      bar.setAttribute('x', '170');
      bar.setAttribute('y', String(y));
      bar.setAttribute('width', String(Math.max(2, 320 * Number(count) / maxCount)));
      bar.setAttribute('height', '24');
      bar.setAttribute('rx', '4');
      bar.setAttribute('fill', '#138a83');

      const countText = document.createElementNS(namespace, 'text');
      countText.setAttribute('x', '505');
      countText.setAttribute('y', String(y + 17));
      countText.setAttribute('fill', '#1f2937');
      countText.setAttribute('font-size', '13');
      countText.textContent = String(count);
      el.targetCountsChart.append(labelText, background, bar, countText);
    });
    el.targetCountsChart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  function getBadgeClass(statusStr) {
    const s = String(statusStr).toLowerCase();
    if (s.includes('stunt')) return 'badge-stunting';
    if (s.includes('wast')) return 'badge-wasting';
    if (s.includes('under')) return 'badge-underweight';
    if (s.includes('over')) return 'badge-overweight';
    return 'badge-healthy';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function setupFoodExplorers() {
    document.querySelectorAll('[data-food-explorer]').forEach(explorer => {
      const panel = explorer.parentElement;
      const detail = panel.querySelector('.nutrient-food-detail');
      if (!detail) return;
      let selectedButton = null;

      panel.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;

        if (button.hasAttribute('data-nutrient-close')) {
          detail.hidden = true;
          if (selectedButton) selectedButton.setAttribute('aria-expanded', 'false');
          if (selectedButton) selectedButton.focus();
          selectedButton = null;
          return;
        }
        if (!explorer.contains(button)) return;

        const information = NUTRIENT_FOOD_INFO[button.dataset.nutrient];
        if (!information) return;

        if (selectedButton) selectedButton.setAttribute('aria-expanded', 'false');
        selectedButton = button;
        selectedButton.setAttribute('aria-expanded', 'true');

        const heading = document.createElement('h4');
        heading.textContent = information.label;
        const role = document.createElement('p');
        role.textContent = information.role;
        const foodHeading = document.createElement('h5');
        foodHeading.textContent = 'Food examples';
        const foodList = document.createElement('ul');
        foodList.className = 'nutrient-food-list';
        information.foods.forEach(food => {
          const item = document.createElement('li');
          item.textContent = food;
          foodList.appendChild(item);
        });
        const safety = document.createElement('p');
        safety.className = 'nutrient-food-safety';
        safety.textContent = `Food safety: ${information.safety}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn-secondary nutrient-food-close';
        close.setAttribute('data-nutrient-close', '');
        close.textContent = 'Close food information';

        detail.replaceChildren(heading, role, foodHeading, foodList, safety, close);
        detail.hidden = false;
      });
    });
  }

  function populateNutritionGuidance(panel, category) {
    const categoryText = String(category || '').trim();
    const normalizedCategory = categoryText.toLowerCase();
    const categoryKey = Object.keys(NUTRITION_GUIDANCE).find(
      supportedCategory => supportedCategory.toLowerCase() === normalizedCategory
    );
    const guidance = categoryKey ? NUTRITION_GUIDANCE[categoryKey] : null;
    const title = panel.querySelector('h3');
    const content = panel.querySelector('.nutrition-guidance-content');
    if (!title || !content) return;

    title.textContent = categoryText
      ? `Nutrition Guidance: ${categoryText}`
      : 'Nutrition Guidance';
    content.replaceChildren();

    const notice = document.createElement('p');
    notice.className = 'nutrition-guidance-notice';
    notice.textContent = TRANSLATIONS.en.nutritionDisclaimer;
    content.appendChild(notice);

    if (!guidance) {
      const unavailable = document.createElement('p');
      unavailable.textContent = 'No category-specific food examples are available.';
      content.appendChild(unavailable);
    }

    if (guidance) {
      const foodGrid = document.createElement('div');
      foodGrid.className = 'nutrition-guidance-grid';
      guidance.groups.forEach(group => {
        const card = document.createElement('article');
        card.className = 'nutrition-guidance-card';
        const image = document.createElement('img');
        image.src = group.image;
        image.alt = group.alt;
        image.loading = 'lazy';
        const heading = document.createElement('h4');
        heading.textContent = group.title;
        const explanation = document.createElement('p');
        explanation.textContent = group.explanation;
        const foods = document.createElement('p');
        const foodLabel = document.createElement('strong');
        foodLabel.textContent = 'Food examples: ';
        foods.append(foodLabel, document.createTextNode(group.foods.join(', ')));
        card.append(image, heading, explanation, foods);
        foodGrid.appendChild(card);
      });
      content.appendChild(foodGrid);

      const habitsCard = document.createElement('article');
      habitsCard.className = 'nutrition-guidance-card nutrition-habits-card';
      const habitsImage = document.createElement('img');
      habitsImage.src = '/static/foods/healthy-habits.svg';
      habitsImage.alt = 'Illustration of healthy daily routines';
      habitsImage.loading = 'lazy';
      const habitsTitle = document.createElement('h4');
      habitsTitle.textContent = 'Healthy habits';
      const habitsList = document.createElement('ul');
      guidance.habits.forEach(habit => {
        const item = document.createElement('li');
        item.textContent = habit;
        habitsList.appendChild(item);
      });
      habitsCard.append(habitsImage, habitsTitle, habitsList);
      content.appendChild(habitsCard);
    }

  }

  function setupPredictionNutritionGuidance() {
    if (el.openNutritionGuidanceBtn && el.predictionNutritionGuidance && el.resultBody) {
      el.openNutritionGuidanceBtn.addEventListener('click', () => {
        populateNutritionGuidance(el.predictionNutritionGuidance, state.lastPrediction && state.lastPrediction.detectedAs);
        el.predictionNutritionGuidance.hidden = false;
        el.resultBody.classList.add('guidance-open');
        el.predictionNutritionGuidance.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      el.predictionNutritionGuidance.querySelector('[data-guidance-back]').addEventListener('click', () => {
        el.predictionNutritionGuidance.hidden = true;
        el.resultBody.classList.remove('guidance-open');
        el.openNutritionGuidanceBtn.focus();
      });
    }

    if (el.batchResultsBody && el.batchNutritionGuidance && el.batchResults) {
      let guidanceTrigger = null;
      el.batchResultsBody.addEventListener('click', event => {
        const button = event.target.closest('[data-guidance-row]');
        if (!button || !state.batchResult) return;
        const targetRow = state.batchResult.results.find(
          result => String(result.row_number) === button.dataset.guidanceRow
        );
        if (!targetRow) return;

        guidanceTrigger = button;
        populateNutritionGuidance(el.batchNutritionGuidance, targetRow.predicted_status);
        el.batchNutritionGuidance.hidden = false;
        el.batchResults.classList.add('guidance-open');
        el.batchNutritionGuidance.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      el.batchNutritionGuidance.querySelector('[data-guidance-back]').addEventListener('click', () => {
        el.batchNutritionGuidance.hidden = true;
        el.batchResults.classList.remove('guidance-open');
        if (guidanceTrigger) guidanceTrigger.focus();
        guidanceTrigger = null;
      });
    }
  }

  // ============================================================================
  // Screening Form & Inference Execution
  // ============================================================================
  function setupPredictionForm() {
    if (el.sexMaleBtn && el.sexFemaleBtn) {
      el.sexMaleBtn.addEventListener('click', () => setSex('male'));
      el.sexFemaleBtn.addEventListener('click', () => setSex('female'));
    }

    if (el.inputAge) {
      el.inputAge.addEventListener('input', () => el.inputAge.setCustomValidity(''));
      el.inputAge.addEventListener('invalid', () => {
        el.inputAge.setCustomValidity('Age must be a whole number from 1 to 21 years, inclusive.');
      });
    }

    if (el.inputHeight) el.inputHeight.addEventListener('input', updateFormLiveBmi);
    if (el.inputWeight) el.inputWeight.addEventListener('input', updateFormLiveBmi);

    if (el.predictionForm) {
      el.predictionForm.addEventListener('submit', handlePredictionSubmit);
    }
    if (el.newPredictionBtn) {
      el.newPredictionBtn.addEventListener('click', resetPredictionForm);
    }
    if (el.downloadReportBtn) el.downloadReportBtn.addEventListener('click', downloadScreeningReport);
    if (el.speakResultBtn) el.speakResultBtn.addEventListener('click', speakScreeningResult);
    if (el.saveHistoryBtn) el.saveHistoryBtn.addEventListener('click', saveLastPredictionToHistory);
  }

  function setSex(sex) {
    state.selectedSex = sex;
    if (el.sexMaleBtn) {
      el.sexMaleBtn.classList.toggle('active', sex === 'male');
      el.sexMaleBtn.setAttribute('aria-pressed', String(sex === 'male'));
    }
    if (el.sexFemaleBtn) {
      el.sexFemaleBtn.classList.toggle('active', sex === 'female');
      el.sexFemaleBtn.setAttribute('aria-pressed', String(sex === 'female'));
    }
  }

  function updateFormLiveBmi() {
    const h = parseFloat(el.inputHeight.value);
    const w = parseFloat(el.inputWeight.value);
    if (h > 20 && w > 1) {
      const heightM = h / 100.0;
      const bmi = (w / (heightM * heightM)).toFixed(2);
      if (el.liveBmiDisplay) el.liveBmiDisplay.textContent = `${bmi} kg/m²`;
    } else {
      if (el.liveBmiDisplay) el.liveBmiDisplay.textContent = '-- kg/m²';
    }
  }

  async function handlePredictionSubmit(e) {
    e.preventDefault();
    hideAlert();

    const sex = state.selectedSex;
    const age = Number(el.inputAge.value);
    const height = parseFloat(el.inputHeight.value);
    const weight = parseFloat(el.inputWeight.value);

    if (!Number.isInteger(age) || age < MIN_SCREENING_AGE || age > MAX_SCREENING_AGE) {
      showAlert('Age must be a whole number from 1 to 21 years, inclusive.');
      return;
    }
    if (isNaN(height) || height <= 20 || height > 250) {
      showAlert('Please enter a valid height between 20 cm and 250 cm.');
      return;
    }
    if (isNaN(weight) || weight <= 1 || weight > 150) {
      showAlert('Please enter a valid weight greater than 1 kg and no more than 150 kg.');
      return;
    }

    setLoading(true);

    try {
      const { data } = await requestJson('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Sex: sex, Age: age, Height: height, Weight: weight })
      });

      if (data.error) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map(issue => issue.msg).join(' ')
          : data.detail || data.error;
        throw new Error(detail || 'The server could not complete the screening.');
      }

      const rawPrediction = data['Detected as'] || data['prediction'];
      if (!rawPrediction) throw new Error('No prediction class was returned by the model.');

      const calculatedBmi = data.bmi ?? (weight / ((height / 100) * (height / 100))).toFixed(2);
      const screenedAt = data.timestamp ? new Date(data.timestamp) : new Date();
      const predictionRecord = {
        id: state.editingRecordId || String(Date.now()),
        childCode: el.inputChildCode ? el.inputChildCode.value.trim() : '',
        timestamp: screenedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullDate: screenedAt.toLocaleDateString(),
        screenedAt: screenedAt.toISOString(),
        sex: sex.charAt(0).toUpperCase() + sex.slice(1),
        age: age,
        height: height,
        weight: weight,
        bmi: calculatedBmi,
        detectedAs: rawPrediction,
        explainability: data.explainability || null,
        savedToHistory: false
      };

      state.lastPrediction = predictionRecord;
      displayExplainableResult(predictionRecord);

    } catch (err) {
      if (err.name === 'TimeoutError') {
        showAlert('Screening request timed out. FastAPI server took too long to respond.');
      } else if (err.name === 'NetworkError' || (err.message && err.message.includes('not be reached'))) {
        showAlert('Backend offline: Cannot connect to FastAPI server on port 8000. Ensure the server is running.');
      } else if (err.status === 503) {
        showAlert(`Model unavailable: ${err.message || 'Trained ML model is not available on the server.'}`);
      } else if (err.status >= 500) {
        showAlert(`Server error (${err.status}): ${err.message || 'Internal server error occurred.'}`);
      } else {
        showAlert(`Screening error: ${err.message || 'Unable to communicate with the screening service.'}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    if (!el.predictSubmitBtn) return;
    el.predictSubmitBtn.disabled = isLoading;
    const dict = TRANSLATIONS.en;
    if (isLoading) {
      el.predictSubmitBtn.innerHTML = `<span class="spinner"></span> ${dict.btnProcessing}`;
    } else {
      el.predictSubmitBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>
        ${dict.btnGeneratePrediction}
      `;
    }
  }

  function showAlert(msg) {
    if (!el.predictAlert) return;
    el.predictAlert.textContent = msg;
    el.predictAlert.style.display = 'block';
  }

  function hideAlert() {
    if (!el.predictAlert) return;
    el.predictAlert.style.display = 'none';
  }

  // ============================================================================
  // Explainable Prediction Presentation
  // ============================================================================
  function displayExplainableResult(record, shouldScroll = true) {
    const condition = record.detectedAs;
    const dict = TRANSLATIONS.en;
    const conditionLabels = {
      Stunting: 'Stunting',
      Wasting: 'Wasting',
      Underweight: 'Underweight',
      Overweight: 'Overweight'
    };

    // Set Status Badge
    if (el.resultBadge) {
      el.resultBadge.className = `result-status-badge ${getBadgeClass(condition)}`;
      el.resultBadge.textContent = conditionLabels[condition] || condition;
    }
    if (el.resultBody && el.predictionNutritionGuidance) {
      el.resultBody.classList.remove('guidance-open');
      el.predictionNutritionGuidance.hidden = true;
    }

    // Keep the result descriptive without inferring a clinical cause.
    if (el.resultExplanationBox) {
      el.resultExplanationBox.textContent = 'The saved SVM model produced the classification shown above from the entered measurements.';
    }
    if (el.ageValidationNotice) {
      const outsideObservedRange = record.age < OBSERVED_DATASET_AGE_MIN || record.age > OBSERVED_DATASET_AGE_MAX;
      el.ageValidationNotice.hidden = !outsideObservedRange;
      el.ageValidationNotice.textContent = outsideObservedRange
        ? `Age ${record.age} is outside the observed dataset and saved model support-vector range (1–5 years). This prediction is an unvalidated model extrapolation, not a validated result.`
        : '';
    }

    const explanation = record.explainability;
    if (el.expRationaleText) {
      el.expRationaleText.textContent = !explanation || !explanation.available
        ? dict.sensitivityUnavailable
        : explanation.note_en;
    }
    if (el.expFeatureList) {
      el.expFeatureList.replaceChildren();
      const affectedFeatures = explanation && explanation.available
        ? explanation.features.filter(feature => feature.changed_prediction)
        : [];
      if (affectedFeatures.length === 0 && explanation && explanation.available) {
        const item = document.createElement('li');
        item.textContent = dict.sensitivityNoInfluence;
        el.expFeatureList.appendChild(item);
      } else {
        const labels = {
          Sex: dict.sensitivityLabelSex,
          Age: dict.sensitivityLabelAge,
          Height: dict.sensitivityLabelHeight,
          Weight: dict.sensitivityLabelWeight
        };
        affectedFeatures.forEach(feature => {
          feature.variants.filter(variant => variant.changed_prediction).forEach(variant => {
            const item = document.createElement('li');
            item.textContent = `${labels[feature.feature] || feature.feature} ${dict.sensitivityValueTo} ${variant.value}: ${dict.sensitivityPrediction} ${conditionLabels[variant.prediction] || variant.prediction}`;
            el.expFeatureList.appendChild(item);
          });
        });
      }
    }

    // General next steps do not prescribe condition-specific treatment.
    if (el.nextStepsGuidanceBox) {
      el.nextStepsGuidanceBox.textContent = `${dict.generalNextSteps} ${dict.generalNextStepsUrgent}`;
    }

    // Populate Demographics Summary
    if (el.resSummarySex) el.resSummarySex.textContent = record.sex;
    if (el.resSummaryAge) el.resSummaryAge.textContent = `${record.age} years`;
    if (el.resSummaryHeight) el.resSummaryHeight.textContent = `${record.height} cm`;
    if (el.resSummaryWeight) el.resSummaryWeight.textContent = `${record.weight} kg`;
    if (el.resSummaryBmi) el.resSummaryBmi.textContent = `${record.bmi} kg/m²`;
    if (el.resSummaryTimestamp) el.resSummaryTimestamp.textContent = `${record.fullDate} ${record.timestamp}`;
    if (el.saveHistoryBtn) {
      el.saveHistoryBtn.disabled = record.savedToHistory === true;
      el.saveHistoryBtn.textContent = record.savedToHistory === true
        ? dict.btnSavedToHistory
        : state.editingRecordId ? 'Update saved screening' : dict.btnSaveToHistory;
    }

    if (el.resultPlaceholder) el.resultPlaceholder.style.display = 'none';
    if (el.resultDisplayCard) el.resultDisplayCard.style.display = 'block';

    if (shouldScroll && window.innerWidth < 992 && el.resultDisplayCard) {
      el.resultDisplayCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function resetPredictionForm() {
    if (el.predictionForm) el.predictionForm.reset();
    state.lastPrediction = null;
    state.editingRecordId = null;
    if (el.resultBody) el.resultBody.classList.remove('guidance-open');
    if (el.predictionNutritionGuidance) el.predictionNutritionGuidance.hidden = true;
    setSex('male');
    if (el.liveBmiDisplay) el.liveBmiDisplay.textContent = '-- kg/m²';
    hideAlert();
    if (el.voiceStatus) el.voiceStatus.textContent = '';
    if (el.reportStatus) el.reportStatus.textContent = '';
    if (el.saveHistoryStatus) el.saveHistoryStatus.textContent = '';

    if (el.resultPlaceholder) el.resultPlaceholder.style.display = 'flex';
    if (el.resultDisplayCard) el.resultDisplayCard.style.display = 'none';
  }

  async function downloadScreeningReport() {
    if (!state.lastPrediction || !el.downloadReportBtn) return;
    const dict = TRANSLATIONS.en;
    const record = state.lastPrediction;
    el.downloadReportBtn.disabled = true;
    if (el.reportStatus) el.reportStatus.textContent = dict.reportPreparing;

    try {
      const response = await fetchWithTimeout('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Sex: record.sex.toLowerCase(),
          Age: record.age,
          Height: record.height,
          Weight: record.weight
        })
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || errorBody.error || 'Report endpoint returned an error.');
      }

      const pdf = await response.blob();
      if (pdf.type !== 'application/pdf' || pdf.size < 100) {
        throw new Error('The server did not return a valid PDF report.');
      }

      const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(pdf);
      link.href = objectUrl;
      link.download = `nutrishield-screening-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      if (el.reportStatus) el.reportStatus.textContent = dict.reportDownloaded;
    } catch (error) {
      if (el.reportStatus) el.reportStatus.textContent = dict.reportFailed;
      console.error('Screening report download failed:', error);
    } finally {
      el.downloadReportBtn.disabled = false;
    }
  }

  function findSpeechVoice(language) {
    const speech = window.speechSynthesis;
    const findMatchingVoice = () => speech.getVoices().find(voice =>
      voice.lang.toLowerCase().startsWith(language.toLowerCase())
    );
    const voice = findMatchingVoice();
    if (voice || speech.getVoices().length > 0) return Promise.resolve(voice || null);

    return new Promise(resolve => {
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        speech.removeEventListener('voiceschanged', finish);
        resolve(findMatchingVoice() || null);
      };
      speech.addEventListener('voiceschanged', finish, { once: true });
      window.setTimeout(finish, 1200);
    });
  }

  async function speakScreeningResult() {
    if (!state.lastPrediction || !el.speakResultBtn) return;
    const dict = TRANSLATIONS.en;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      if (el.voiceStatus) el.voiceStatus.textContent = dict.voiceUnavailable;
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (el.voiceStatus) el.voiceStatus.textContent = dict.voiceStopped;
      return;
    }

    const voice = await findSpeechVoice('en');
    if (!voice) {
      if (el.voiceStatus) el.voiceStatus.textContent = dict.voiceMissingLanguage.replace('{language}', 'English');
      return;
    }

    const text = `Screening result: ${state.lastPrediction.detectedAs}. ${dict.generalNextSteps} ${dict.generalNextStepsUrgent}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    utterance.voice = voice;
    if (el.voiceStatus) el.voiceStatus.textContent = dict.voiceSpeaking;
    window.speechSynthesis.speak(utterance);
  }

  // ============================================================================
  // Nutrition Monitoring & Interactive SVG Growth Charts
  // ============================================================================
  async function loadMonitoringRecords() {
    try {
      const { data } = await requestJson('/api/screenings');
      state.monitoringRecords = Array.isArray(data.records)
        ? data.records.map(screeningToHistoryRecord).filter(Boolean)
        : [];
      if (el.historyStorageStatus) {
        el.historyStorageStatus.textContent = 'Screening records are stored in this application’s SQLite database. Avoid direct identifiers.';
      }
    } catch (error) {
      console.error('Screening history could not be loaded:', error);
      if (el.historyStorageStatus) {
        el.historyStorageStatus.textContent = `Screening history could not be loaded: ${error.message}`;
      }
    }
    updateMonitoringUI();
  }

  function screeningToHistoryRecord(record) {
    const screenedAt = new Date(record.screened_at);
    const dateIsValid = Number.isFinite(screenedAt.getTime());
    return sanitizeHistoryRecord({
      id: record.id,
      childCode: record.child_code || '',
      timestamp: dateIsValid ? screenedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      fullDate: dateIsValid ? screenedAt.toLocaleDateString() : '',
      screenedAt: dateIsValid ? screenedAt.toISOString() : '',
      sex: record.sex,
      age: record.age,
      height: record.height,
      weight: record.weight,
      bmi: record.bmi,
      detectedAs: record.predicted_status,
      explainability: record.explainability
    });
  }

  function sanitizeHistoryRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const age = Number(record.age);
    const height = Number(record.height);
    const weight = Number(record.weight);
    const bmi = Number(record.bmi);
    const categories = ['Stunting', 'Wasting', 'Underweight', 'Overweight'];
    const recordId = String(record.id || '');
    if (!(/^[0-9a-f-]{36}$/i.test(recordId) || /^\d{1,20}$/.test(recordId)) ||
        !['Male', 'Female'].includes(record.sex) ||
        !categories.includes(record.detectedAs) ||
        !Number.isFinite(age) || age < MIN_SCREENING_AGE || age > MAX_SCREENING_AGE || !Number.isInteger(age) ||
        !Number.isFinite(height) || height <= 20 || height > 250 ||
        !Number.isFinite(weight) || weight <= 1 || weight > 200 ||
        !Number.isFinite(bmi)) return null;

    return {
      id: recordId,
      childCode: String(record.childCode || '').slice(0, 64),
      timestamp: String(record.timestamp || '').slice(0, 40),
      fullDate: String(record.fullDate || '').slice(0, 40),
      screenedAt: typeof record.screenedAt === 'string' ? record.screenedAt.slice(0, 64) : '',
      sex: record.sex,
      age,
      height,
      weight,
      bmi,
      detectedAs: record.detectedAs,
      savedToHistory: true,
      explainability: sanitizeHistoryExplanation(record.explainability)
    };
  }

  function sanitizeHistoryExplanation(explanation) {
    const allowedFeatures = ['Sex', 'Age', 'Height', 'Weight'];
    const allowedClasses = ['Stunting', 'Wasting', 'Underweight', 'Overweight'];
    if (!explanation || explanation.method !== 'one_feature_at_a_time' ||
        !Array.isArray(explanation.features)) return null;

    return {
      available: explanation.available === true,
      method: 'one_feature_at_a_time',
      note_en: String(explanation.note_en || '').slice(0, 500),
      features: explanation.features.filter(feature =>
        feature && allowedFeatures.includes(feature.feature) && Array.isArray(feature.variants)
      ).map(feature => ({
        feature: feature.feature,
        input_value: String(feature.input_value || '').slice(0, 32),
        changed_prediction: feature.changed_prediction === true,
        variants: feature.variants.filter(variant =>
          variant && allowedClasses.includes(variant.prediction) && typeof variant.value === 'string'
        ).map(variant => ({
          value: variant.value.slice(0, 32),
          prediction: variant.prediction,
          changed_prediction: variant.changed_prediction === true
        }))
      }))
    };
  }

  async function saveLastPredictionToHistory() {
    const record = state.lastPrediction;
    if (!record || record.savedToHistory) return;
    const payload = {
      Sex: record.sex.toLowerCase(),
      Age: record.age,
      Height: record.height,
      Weight: record.weight,
      child_code: record.childCode || null
    };
    const endpoint = state.editingRecordId
      ? `/api/screenings/${encodeURIComponent(state.editingRecordId)}`
      : '/api/screenings';
    const method = state.editingRecordId ? 'PATCH' : 'POST';
    if (el.saveHistoryBtn) el.saveHistoryBtn.disabled = true;
    if (el.saveHistoryStatus) el.saveHistoryStatus.textContent = 'Saving screening to the secure server history…';
    try {
      const { data } = await requestJson(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const savedRecord = screeningToHistoryRecord(data.record);
      if (!savedRecord) throw new Error('The saved screening response was invalid.');
      savedRecord.savedToHistory = true;
      const existingIndex = state.monitoringRecords.findIndex(item => item.id === savedRecord.id);
      if (existingIndex >= 0) state.monitoringRecords.splice(existingIndex, 1, savedRecord);
      else state.monitoringRecords.unshift(savedRecord);
      state.lastPrediction = savedRecord;
      record.savedToHistory = true;
      updateMonitoringUI();
      if (el.saveHistoryStatus) el.saveHistoryStatus.textContent = 'Screening saved to the screening history.';
      displayExplainableResult(record, false);
    } catch (error) {
      console.error('Screening could not be saved:', error);
      if (el.saveHistoryStatus) el.saveHistoryStatus.textContent = `Screening was not saved: ${error.message}`;
    } finally {
      if (el.saveHistoryBtn) el.saveHistoryBtn.disabled = Boolean(state.lastPrediction && state.lastPrediction.savedToHistory);
    }
  }

  async function deleteRecord(recordId) {
    if (confirm('Delete this screening record?')) {
      try {
        await requestJson(`/api/screenings/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Screening record could not be deleted:', error);
        if (el.historyStorageStatus) {
          el.historyStorageStatus.textContent = `The record could not be deleted: ${error.message}`;
        }
        return;
      }
      state.monitoringRecords = state.monitoringRecords.filter(r => r.id !== String(recordId));
      updateMonitoringUI();
    }
  }

  async function clearAllHistory() {
    if (confirm('Clear all saved screening records? (This will not delete model files or datasets).')) {
      try {
        await requestJson('/api/screenings', { method: 'DELETE' });
      } catch (error) {
        console.error('Screening history could not be cleared:', error);
        if (el.historyStorageStatus) {
          el.historyStorageStatus.textContent = `Screening history could not be cleared: ${error.message}`;
        }
        return;
      }
      state.monitoringRecords = [];
      updateMonitoringUI();
    }
  }

  function updateMonitoringUI() {
    const total = state.monitoringRecords.length;
    if (el.sessionCountPill) el.sessionCountPill.textContent = String(total);
    if (el.dashSessionTotal) el.dashSessionTotal.textContent = String(total);

    renderDashboardRecentTable();
    renderMonitoringHistoryTable();
    renderGrowthCharts();
  }

  function getHistoryClassLabel(record) {
    return record.age > OBSERVED_DATASET_AGE_MAX
      ? `${record.detectedAs} (unvalidated age extrapolation)`
      : record.detectedAs;
  }

  function renderDashboardRecentTable() {
    if (!el.dashRecentHistoryTable) return;
    const dict = TRANSLATIONS.en;

    if (state.monitoringRecords.length === 0) {
      el.dashRecentHistoryTable.innerHTML = `
        <tr>
          <td colspan="5" class="empty-history-placeholder">${dict.emptyRecentHistory}</td>
        </tr>
      `;
      return;
    }

    const recent = state.monitoringRecords.slice(0, 5);
    el.dashRecentHistoryTable.innerHTML = recent.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.timestamp)}</strong> <small style="color:var(--color-slate-muted)">${escapeHtml(p.fullDate)}</small></td>
        <td>${escapeHtml(p.sex)}, ${escapeHtml(p.age)}y</td>
        <td>${escapeHtml(p.height)} cm / ${escapeHtml(p.weight)} kg</td>
        <td><span class="badge ${getBadgeClass(p.detectedAs)}">${escapeHtml(getHistoryClassLabel(p))}</span></td>
        <td>
          <button class="preset-chip" onclick="window.NutriShieldApp.inspectRecord('${p.id}')">
            Inspect
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderMonitoringHistoryTable() {
    if (!el.historyTableBody) return;
    const filterVal = el.historyFilterSelect ? el.historyFilterSelect.value : 'all';
    const searchText = el.historySearchInput ? el.historySearchInput.value.trim().toLowerCase() : '';

    const filteredByClass = filterVal === 'all'
      ? state.monitoringRecords
      : state.monitoringRecords.filter(p => p.detectedAs.toLowerCase() === filterVal.toLowerCase());
    const filtered = searchText
      ? filteredByClass.filter(record =>
        record.id.toLowerCase().includes(searchText) ||
        record.childCode.toLowerCase().includes(searchText)
      )
      : filteredByClass;

    if (filtered.length === 0) {
      el.historyTableBody.innerHTML = `
        <tr>
          <td colspan="10" class="empty-history-placeholder">
            No screening records found.
          </td>
        </tr>
      `;
      return;
    }

    el.historyTableBody.innerHTML = filtered.map((p, idx) => `
      <tr>
        <td>#${filtered.length - idx}</td>
        <td>${escapeHtml(p.timestamp)} <small style="color:var(--color-slate-muted)">${escapeHtml(p.fullDate)}</small></td>
        <td>${escapeHtml(p.childCode || '—')}</td>
        <td>${escapeHtml(p.sex)}</td>
        <td>${escapeHtml(p.age)}y</td>
        <td>${escapeHtml(p.height)} cm</td>
        <td>${escapeHtml(p.weight)} kg</td>
        <td>${escapeHtml(p.bmi)}</td>
        <td><span class="badge ${getBadgeClass(p.detectedAs)}">${escapeHtml(getHistoryClassLabel(p))}</span></td>
        <td>
          <button class="preset-chip" onclick="window.NutriShieldApp.inspectRecord('${p.id}')">
            Edit
          </button>
          <button class="action-btn-danger" onclick="window.NutriShieldApp.deleteRecord('${p.id}')">
            Delete
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Pure Vanilla SVG Interactive Growth Charts (Zero External Network Bloat)
  function renderGrowthCharts() {
    renderWeightTrendChart();
    renderBmiTrendChart();
    renderSummaryDistributionChart();
  }

  function renderWeightTrendChart() {
    if (!el.weightChartSvg) return;
    const records = [...state.monitoringRecords].reverse();

    if (records.length < 2) {
      el.weightChartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" fill="#64748b" font-size="12">
          Add at least 2 screenings to generate weight trajectory
        </text>
      `;
      return;
    }

    const width = 450;
    const height = 220;
    const padding = 35;

    const weights = records.map(r => r.weight);
    const minW = Math.max(0, Math.floor(Math.min(...weights) - 2));
    const maxW = Math.ceil(Math.max(...weights) + 2);

    const getX = (idx) => padding + (idx / (records.length - 1)) * (width - 2 * padding);
    const getY = (val) => height - padding - ((val - minW) / (maxW - minW || 1)) * (height - 2 * padding);

    const points = records.map((r, i) => `${getX(i)},${getY(r.weight)}`).join(' ');

    let svgContent = `
      <defs>
        <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#138a83" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#138a83" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Grid Lines -->
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#dce4ee" stroke-width="1.5"/>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#dce4ee" stroke-width="1.5"/>

      <!-- Area fill -->
      <polygon points="${padding},${height - padding} ${points} ${width - padding},${height - padding}" fill="url(#weightGrad)"/>

      <!-- Line -->
      <polyline points="${points}" fill="none" stroke="#138a83" stroke-width="2.5" stroke-linecap="round"/>
    `;

    // Add points & tooltips
    records.forEach((r, i) => {
      const cx = getX(i);
      const cy = getY(r.weight);
      svgContent += `
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="#ffffff" stroke="#138a83" stroke-width="2">
          <title>${escapeHtml(r.fullDate)}: ${r.weight} kg (${escapeHtml(r.detectedAs)})</title>
        </circle>
        <text x="${cx}" y="${cy - 9}" font-size="10" font-weight="700" fill="#1f2937" text-anchor="middle">${r.weight}kg</text>
        <text x="${cx}" y="${height - 12}" font-size="9" fill="#64748b" text-anchor="middle">${r.timestamp}</text>
      `;
    });

    el.weightChartSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.weightChartSvg.innerHTML = svgContent;
  }

  function renderBmiTrendChart() {
    if (!el.bmiChartSvg) return;
    const records = [...state.monitoringRecords].reverse();

    if (records.length < 2) {
      el.bmiChartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" fill="#64748b" font-size="12">
          Add at least 2 screenings to generate BMI trend
        </text>
      `;
      return;
    }

    const width = 450;
    const height = 220;
    const padding = 35;

    const bmis = records.map(r => parseFloat(r.bmi) || 15);
    const minB = Math.max(5, Math.floor(Math.min(...bmis) - 2));
    const maxB = Math.ceil(Math.max(...bmis) + 2);

    const getX = (idx) => padding + (idx / (records.length - 1)) * (width - 2 * padding);
    const getY = (val) => height - padding - ((val - minB) / (maxB - minB || 1)) * (height - 2 * padding);

    const points = records.map((r, i) => `${getX(i)},${getY(parseFloat(r.bmi))}`).join(' ');

    let svgContent = `
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#dce4ee" stroke-width="1.5"/>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#dce4ee" stroke-width="1.5"/>
      <polyline points="${points}" fill="none" stroke="#2457a7" stroke-width="2.5" stroke-linecap="round"/>
    `;

    records.forEach((r, i) => {
      const cx = getX(i);
      const cy = getY(parseFloat(r.bmi));
      svgContent += `
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="#ffffff" stroke="#2457a7" stroke-width="2">
          <title>${escapeHtml(r.fullDate)}: BMI ${r.bmi}</title>
        </circle>
        <text x="${cx}" y="${cy - 9}" font-size="10" font-weight="700" fill="#1f2937" text-anchor="middle">${r.bmi}</text>
        <text x="${cx}" y="${height - 12}" font-size="9" fill="#64748b" text-anchor="middle">${r.timestamp}</text>
      `;
    });

    el.bmiChartSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.bmiChartSvg.innerHTML = svgContent;
  }

  function renderSummaryDistributionChart() {
    if (!el.summaryChartSvg) return;
    const records = state.monitoringRecords;

    if (records.length === 0) {
      el.summaryChartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" fill="#64748b" font-size="12">
          No screenings recorded yet
        </text>
      `;
      return;
    }

    const counts = { Stunting: 0, Wasting: 0, Underweight: 0, Overweight: 0 };
    records.forEach(r => {
      if (counts[r.detectedAs] !== undefined) counts[r.detectedAs]++;
    });

    const total = records.length;
    const categories = [
      { name: 'Stunting', count: counts.Stunting, color: '#b7791f' },
      { name: 'Wasting', count: counts.Wasting, color: '#b42318' },
      { name: 'Underweight', count: counts.Underweight, color: '#2457a7' },
      { name: 'Overweight', count: counts.Overweight, color: '#138a83' }
    ];

    const width = 450;
    const height = 180;
    const barHeight = 22;
    let yPos = 20;

    let svgContent = '';
    categories.forEach(c => {
      const pct = total > 0 ? Math.round((c.count / total) * 100) : 0;
      const barWidth = total > 0 ? (c.count / total) * 260 : 0;

      svgContent += `
        <text x="15" y="${yPos + 15}" font-size="11" font-weight="600" fill="#1f2937">${c.name} (${c.count})</text>
        <rect x="120" y="${yPos}" width="260" height="${barHeight}" rx="4" fill="#edf3fc"/>
        <rect x="120" y="${yPos}" width="${barWidth}" height="${barHeight}" rx="4" fill="${c.color}"/>
        <text x="${130 + barWidth}" y="${yPos + 15}" font-size="10" font-weight="700" fill="#1f2937">${pct}%</text>
      `;
      yPos += 38;
    });

    el.summaryChartSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.summaryChartSvg.innerHTML = svgContent;
  }

  async function exportHistoryToCsv() {
    try {
      const response = await fetchWithTimeout('/api/screenings/export.csv');
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || `Export failed (${response.status}).`);
      }
      const csv = await response.blob();
      downloadBatchBlob(
        `nutrishield_screening_history_${new Date().toISOString().slice(0, 10)}.csv`,
        csv
      );
    } catch (error) {
      console.error('Screening history export failed:', error);
      if (el.historyStorageStatus) el.historyStorageStatus.textContent = `History export failed: ${error.message}`;
    }
  }

  // ============================================================================
  // Nutrition Education Tab Controller
  // ============================================================================
  // ============================================================================
  // Batch Dataset Prediction
  // ============================================================================
  function setBatchStatus(message, type = '') {
    if (!el.batchStatus) return;
    el.batchStatus.textContent = message;
    el.batchStatus.className = `form-hint batch-status${type ? ` is-${type}` : ''}`;
  }

  function downloadBatchBlob(filename, blob) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function escapeBatchCsvValue(value) {
    const text = value == null ? '' : String(value);
    const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }

  async function downloadBatchTemplate() {
    if (!el.downloadBatchTemplateBtn) return;
    el.downloadBatchTemplateBtn.disabled = true;
    try {
      const response = await fetchWithTimeout('/api/batch-template');
      if (!response.ok) throw new Error('The batch template could not be downloaded.');
      downloadBatchBlob('nutrishield-batch-template.csv', await response.blob());
      setBatchStatus('Template downloaded. Fill in one record per row, then choose the file.', 'success');
    } catch (error) {
      setBatchStatus(error.message, 'error');
    } finally {
      el.downloadBatchTemplateBtn.disabled = false;
    }
  }

  function uploadBatchFile(file) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${getApiBaseUrl()}/api/batch-predict`);
      request.timeout = 120000;
      request.upload.addEventListener('progress', event => {
        if (!el.batchUploadProgress) return;
        el.batchUploadProgress.hidden = false;
        if (event.lengthComputable && event.total > 0) {
          el.batchUploadProgress.value = Math.round(event.loaded * 100 / event.total);
          setBatchStatus(`Uploading file: ${el.batchUploadProgress.value}%`);
        } else {
          el.batchUploadProgress.removeAttribute('value');
          setBatchStatus('Uploading file...');
        }
      });
      request.upload.addEventListener('load', () => {
        if (el.batchUploadProgress) {
          el.batchUploadProgress.hidden = false;
          el.batchUploadProgress.removeAttribute('value');
        }
        setBatchStatus('Upload complete. Validating rows and running saved SVM predictions...');
      });
      request.addEventListener('load', () => {
        let payload;
        try {
          payload = JSON.parse(request.responseText);
        } catch (error) {
          reject(new Error(`The server returned an invalid response (${request.status}).`));
          return;
        }
        if (request.status < 200 || request.status >= 300) {
          const detail = payload.detail || payload.error || `Upload failed (${request.status}).`;
          reject(new Error(Array.isArray(detail) ? detail.map(issue => issue.msg).join(' ') : detail));
          return;
        }
        resolve(payload);
      });
      request.addEventListener('error', () => reject(new Error('Backend offline: Could not connect to FastAPI server at port 8000.')));
      request.addEventListener('timeout', () => reject(new Error('Batch processing timed out. Try a smaller file.')));
      request.addEventListener('abort', () => reject(new Error('Batch upload was cancelled.')));
      const body = new FormData();
      body.append('upload', file, file.name);
      request.send(body);
    });
  }

  async function submitBatchFile() {
    const file = el.batchFileInput && el.batchFileInput.files[0];
    if (!file) {
      setBatchStatus('Choose a CSV or XLSX file first.', 'error');
      return;
    }
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(extension)) {
      setBatchStatus('Upload a .csv or .xlsx file.', 'error');
      return;
    }
    if (file.size === 0) {
      setBatchStatus('The selected file is empty.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setBatchStatus('The selected file exceeds the 10 MB limit.', 'error');
      return;
    }

    if (el.batchUploadBtn) el.batchUploadBtn.disabled = true;
    if (el.batchResults) el.batchResults.classList.remove('guidance-open');
    if (el.batchNutritionGuidance) el.batchNutritionGuidance.hidden = true;
    if (el.batchResults) el.batchResults.hidden = true;
    if (el.batchUploadProgress) {
      el.batchUploadProgress.hidden = false;
      el.batchUploadProgress.value = 0;
    }
    setBatchStatus('Preparing upload...');

    try {
      const result = await uploadBatchFile(file);
      if (!result.success || !result.summary || !Array.isArray(result.results)) {
        throw new Error('The server did not return a complete batch prediction result.');
      }
      state.batchResult = result;
      state.batchCurrentPage = 1;
      state.batchSortKey = 'row_number';
      state.batchSortDirection = 'asc';
      renderBatchResults();
      if (el.batchResults) el.batchResults.hidden = false;
      const summary = result.summary;
      setBatchStatus(
        `Batch complete: ${summary.successfully_predicted_records} predictions completed; ${summary.rejected_records} rows rejected.`,
        'success'
      );
    } catch (error) {
      state.batchResult = null;
      setBatchStatus(error.message || 'Batch prediction failed. No successful result was produced.', 'error');
    } finally {
      if (el.batchUploadBtn) el.batchUploadBtn.disabled = !el.batchFileInput.files.length;
      if (el.batchUploadProgress) el.batchUploadProgress.hidden = true;
    }
  }

  function renderBatchResults() {
    const result = state.batchResult;
    if (!result || !el.batchTotalRecords || !el.batchClassFilter) return;
    const summary = result.summary;
    el.batchTotalRecords.textContent = String(summary.total_records);
    el.batchValidRecords.textContent = String(summary.successfully_predicted_records);
    el.batchRejectedRecords.textContent = String(summary.rejected_records);
    el.batchDuplicateRecords.textContent = String(summary.duplicate_input_records);
    const ageRangeNote = summary.unsupported_age_records
      ? ` ${summary.unsupported_age_records} predictions are unvalidated extrapolations for ages 6–21; the observed dataset/model range is 1–5 years.`
      : '';
    el.batchDenominatorNote.textContent = `Predicted-category percentages use ${summary.successfully_predicted_records} successfully predicted records as the denominator.${ageRangeNote}`;

    const classFilter = el.batchClassFilter;
    const selectedClass = classFilter.value;
    classFilter.replaceChildren(new Option('All categories', ''));
    Object.keys(summary.predicted_class_distribution).forEach(label => {
      classFilter.add(new Option(label, label));
    });
    classFilter.value = Object.prototype.hasOwnProperty.call(summary.predicted_class_distribution, selectedClass)
      ? selectedClass
      : '';

    renderBatchDistribution();
    renderBatchRejectedRows();
    renderBatchTable();

    [el.batchDownloadCsvBtn, el.batchDownloadValidationBtn, el.batchDownloadSummaryBtn].forEach(button => {
      if (button) button.disabled = false;
    });
  }

  function renderBatchDistribution() {
    if (!el.batchDistributionChart || !state.batchResult) return;
    const distribution = state.batchResult.summary.predicted_class_distribution;
    const labels = Object.keys(distribution);
    const width = 560;
    const rowHeight = 42;
    const chartHeight = Math.max(70, labels.length * rowHeight + 16);
    el.batchDistributionChart.replaceChildren();
    el.batchDistributionChart.setAttribute('viewBox', `0 0 ${width} ${chartHeight}`);

    const palette = ['#2457a7', '#138a83', '#b7791f', '#b42318'];
    labels.forEach((label, index) => {
      const item = distribution[label];
      const y = 12 + index * rowHeight;
      const barWidth = item.percentage * 2.8;
      const labelNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelNode.setAttribute('x', '8');
      labelNode.setAttribute('y', String(y + 17));
      labelNode.setAttribute('fill', '#1f2937');
      labelNode.setAttribute('font-size', '13');
      labelNode.textContent = label;

      const track = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      track.setAttribute('x', '155');
      track.setAttribute('y', String(y));
      track.setAttribute('width', '280');
      track.setAttribute('height', '24');
      track.setAttribute('rx', '4');
      track.setAttribute('fill', '#dce4ee');

      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bar.setAttribute('x', '155');
      bar.setAttribute('y', String(y));
      bar.setAttribute('width', String(barWidth));
      bar.setAttribute('height', '24');
      bar.setAttribute('rx', '4');
      bar.setAttribute('fill', palette[index % palette.length]);

      const value = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      value.setAttribute('x', '450');
      value.setAttribute('y', String(y + 17));
      value.setAttribute('fill', '#1f2937');
      value.setAttribute('font-size', '12');
      value.textContent = `${item.count} (${item.percentage.toFixed(1)}%)`;
      el.batchDistributionChart.append(labelNode, track, bar, value);
    });

    el.batchDistributionLegend.replaceChildren();
    labels.forEach((label, index) => {
      const item = document.createElement('span');
      item.className = 'batch-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'batch-legend-swatch';
      swatch.style.backgroundColor = palette[index % palette.length];
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, document.createTextNode(label));
      el.batchDistributionLegend.appendChild(item);
    });
  }

  function renderBatchRejectedRows() {
    if (!state.batchResult) return;
    const rejectedRows = state.batchResult.rejected_rows;
    el.batchRejectedRowsBody.replaceChildren();
    el.batchValidationSummary.textContent = rejectedRows.length
      ? `${rejectedRows.length} rows were rejected. Row numbers include the header row in the original file.`
      : 'No rows were rejected. Row numbers include the header row in the original file.';

    if (rejectedRows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.className = 'empty-history-placeholder';
      cell.textContent = 'No rejected rows.';
      row.appendChild(cell);
      el.batchRejectedRowsBody.appendChild(row);
      return;
    }

    rejectedRows.forEach(rejected => {
      const row = document.createElement('tr');
      const rowNumber = document.createElement('td');
      rowNumber.textContent = String(rejected.row_number);
      const reasons = document.createElement('td');
      reasons.textContent = rejected.reasons.join(' ');
      row.append(rowNumber, reasons);
      el.batchRejectedRowsBody.appendChild(row);
    });
  }

  function getFilteredBatchRows() {
    if (!state.batchResult) return [];
    const search = el.batchSearchInput.value.trim().toLowerCase();
    const selectedClass = el.batchClassFilter.value;
    const rows = state.batchResult.results.filter(row => {
      if (selectedClass && row.predicted_status !== selectedClass) return false;
      if (!search) return true;
      const searchableText = [row.row_number, row.predicted_status, ...Object.values(row.original)]
        .join(' ')
        .toLowerCase();
      return searchableText.includes(search);
    });

    const key = state.batchSortKey;
    rows.sort((left, right) => {
      let leftValue = key === 'row_number' || key === 'predicted_status' || key === 'duplicate_input'
        ? left[key]
        : left.original[key];
      let rightValue = key === 'row_number' || key === 'predicted_status' || key === 'duplicate_input'
        ? right[key]
        : right.original[key];
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * (state.batchSortDirection === 'asc' ? 1 : -1);
      }
      const comparison = String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      return comparison * (state.batchSortDirection === 'asc' ? 1 : -1);
    });
    return rows;
  }

  function renderBatchTable() {
    if (!state.batchResult) return;
    const inputColumns = state.batchResult.input_columns;
    const columns = [
      { key: 'row_number', label: 'Input row' },
      ...inputColumns.map(column => ({
        key: column,
        label: column === 'Status' ? 'Status (uploaded; not used)' : column
      })),
      { key: 'predicted_status', label: 'Predicted Status' },
      { key: 'age_support', label: 'Dataset/model age range', sortable: false },
      { key: 'nutrition_guidance', label: 'Nutrition Guidance', sortable: false },
      { key: 'duplicate_input', label: 'Duplicate input' }
    ];
    const headerRow = document.createElement('tr');
    columns.forEach(column => {
      const header = document.createElement('th');
      header.scope = 'col';
      header.setAttribute('aria-sort', state.batchSortKey === column.key
        ? state.batchSortDirection === 'asc' ? 'ascending' : 'descending'
        : 'none');
      if (column.sortable === false) {
        header.textContent = column.label;
      } else {
        const sortButton = document.createElement('button');
        sortButton.type = 'button';
        sortButton.className = 'batch-sort-btn';
        sortButton.dataset.sortKey = column.key;
        sortButton.textContent = `${column.label}${state.batchSortKey === column.key ? state.batchSortDirection === 'asc' ? ' ↑' : ' ↓' : ''}`;
        header.appendChild(sortButton);
      }
      headerRow.appendChild(header);
    });
    el.batchResultsHead.replaceChildren(headerRow);

    const filteredRows = getFilteredBatchRows();
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / state.batchPageSize));
    state.batchCurrentPage = Math.min(state.batchCurrentPage, pageCount);
    const startIndex = (state.batchCurrentPage - 1) * state.batchPageSize;
    const pageRows = filteredRows.slice(startIndex, startIndex + state.batchPageSize);
    el.batchResultsBody.replaceChildren();

    if (pageRows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = columns.length;
      cell.className = 'empty-history-placeholder';
      cell.textContent = 'No matching prediction records.';
      row.appendChild(cell);
      el.batchResultsBody.appendChild(row);
    }

    pageRows.forEach(result => {
      const row = document.createElement('tr');
      columns.forEach(column => {
        const cell = document.createElement('td');
        if (column.key === 'row_number') {
          cell.textContent = String(result.row_number);
        } else if (column.key === 'predicted_status') {
          const badge = document.createElement('span');
          badge.className = `badge ${getBadgeClass(result.predicted_status)}`;
          badge.textContent = result.predicted_status;
          cell.appendChild(badge);
        } else if (column.key === 'age_support') {
          cell.textContent = result.age_within_observed_range
            ? 'Within observed range (1–5 years)'
            : 'Outside observed range (6–21): unvalidated extrapolation';
        } else if (column.key === 'nutrition_guidance') {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn-secondary batch-row-guidance-btn';
          button.dataset.guidanceRow = String(result.row_number);
          button.textContent = 'Nutrition Guidance';
          cell.appendChild(button);
        } else if (column.key === 'duplicate_input') {
          cell.textContent = result.duplicate_input ? 'Yes' : 'No';
        } else {
          cell.textContent = String(result.original[column.key] ?? '');
        }
        row.appendChild(cell);
      });
      el.batchResultsBody.appendChild(row);
    });

    const first = filteredRows.length ? startIndex + 1 : 0;
    const last = Math.min(startIndex + pageRows.length, filteredRows.length);
    el.batchPageSummary.textContent = `Showing ${first}-${last} of ${filteredRows.length} matching records`;
    el.batchPreviousPageBtn.disabled = state.batchCurrentPage <= 1;
    el.batchNextPageBtn.disabled = state.batchCurrentPage >= pageCount;
  }

  function downloadBatchResultsCsv() {
    if (!state.batchResult) return;
    const columns = state.batchResult.input_columns;
    const headers = ['Input Row', ...columns, 'Predicted Status', 'Dataset/model age range', 'Duplicate Input'];
    const lines = [headers.map(escapeBatchCsvValue).join(',')];
    state.batchResult.results.forEach(row => {
      lines.push([
        row.row_number,
        ...columns.map(column => row.original[column]),
        row.predicted_status,
        row.age_within_observed_range
          ? 'Within observed range (1-5 years)'
          : 'Outside observed range (6-21 years): unvalidated extrapolation',
        row.duplicate_input ? 'Yes' : 'No'
      ].map(escapeBatchCsvValue).join(','));
    });
    downloadBatchBlob(
      'nutrishield-batch-predictions.csv',
      new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    );
  }

  function downloadBatchValidationCsv() {
    if (!state.batchResult) return;
    const lines = [
      ['Input Row', 'Validation Reasons'].map(escapeBatchCsvValue).join(','),
      ...state.batchResult.rejected_rows.map(row => [row.row_number, row.reasons.join(' ')].map(escapeBatchCsvValue).join(','))
    ];
    downloadBatchBlob(
      'nutrishield-batch-validation-report.csv',
      new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    );
  }

  function downloadBatchSummary() {
    if (!state.batchResult) return;
    const { summary, disclaimer } = state.batchResult;
    const lines = [
      'NutriShield - AI-Powered Child Nutrition Screening and Monitoring System',
      'Batch prediction summary',
      '',
      `Uploaded records: ${summary.total_records}`,
      `Valid predictions: ${summary.successfully_predicted_records}`,
      `Rejected records: ${summary.rejected_records}`,
      `Duplicate input records: ${summary.duplicate_input_records}`,
      `Predictions outside the observed 1-5 age range: ${summary.unsupported_age_records}`,
      `Percentage denominator: ${summary.percentage_denominator} successfully predicted records`,
      '',
      'Model-predicted categories:',
      ...Object.entries(summary.predicted_class_distribution).map(([label, item]) =>
        `${label}: ${item.count} (${item.percentage.toFixed(1)}%)`
      ),
      '',
      disclaimer
    ];
    downloadBatchBlob('nutrishield-batch-summary.txt', new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }));
  }

  function setupBatchPrediction() {
    if (el.batchFileInput) {
      el.batchFileInput.addEventListener('change', () => {
        const file = el.batchFileInput.files[0];
        el.batchFileName.textContent = file ? file.name : 'No file selected';
        el.batchUploadBtn.disabled = !file;
        state.batchResult = null;
        if (el.batchResults) el.batchResults.classList.remove('guidance-open');
        if (el.batchNutritionGuidance) el.batchNutritionGuidance.hidden = true;
        if (el.batchResults) el.batchResults.hidden = true;
        if (file) setBatchStatus(`${file.name} selected. Upload to validate and predict.`, '');
      });
    }
    if (el.batchUploadBtn) el.batchUploadBtn.addEventListener('click', submitBatchFile);
    if (el.downloadBatchTemplateBtn) el.downloadBatchTemplateBtn.addEventListener('click', downloadBatchTemplate);
    if (el.batchSearchInput) el.batchSearchInput.addEventListener('input', () => {
      state.batchCurrentPage = 1;
      renderBatchTable();
    });
    if (el.batchClassFilter) el.batchClassFilter.addEventListener('change', () => {
      state.batchCurrentPage = 1;
      renderBatchTable();
    });
    if (el.batchResultsHead) el.batchResultsHead.addEventListener('click', event => {
      const sortButton = event.target.closest('[data-sort-key]');
      if (!sortButton) return;
      const sortKey = sortButton.dataset.sortKey;
      state.batchSortDirection = state.batchSortKey === sortKey && state.batchSortDirection === 'asc' ? 'desc' : 'asc';
      state.batchSortKey = sortKey;
      renderBatchTable();
    });
    if (el.batchPreviousPageBtn) el.batchPreviousPageBtn.addEventListener('click', () => {
      state.batchCurrentPage = Math.max(1, state.batchCurrentPage - 1);
      renderBatchTable();
    });
    if (el.batchNextPageBtn) el.batchNextPageBtn.addEventListener('click', () => {
      state.batchCurrentPage += 1;
      renderBatchTable();
    });
    if (el.batchDownloadCsvBtn) el.batchDownloadCsvBtn.addEventListener('click', downloadBatchResultsCsv);
    if (el.batchDownloadValidationBtn) el.batchDownloadValidationBtn.addEventListener('click', downloadBatchValidationCsv);
    if (el.batchDownloadSummaryBtn) el.batchDownloadSummaryBtn.addEventListener('click', downloadBatchSummary);
    [el.batchDownloadCsvBtn, el.batchDownloadValidationBtn, el.batchDownloadSummaryBtn].forEach(button => {
      if (button) button.disabled = true;
    });
  }

  // ============================================================================
  // Initialization Lifecycle
  // ============================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupNavigation();
    setupPredictionForm();
    setupPredictionNutritionGuidance();
    setupFoodExplorers();
    setupBatchPrediction();

    if (el.clearHistoryBtn) el.clearHistoryBtn.addEventListener('click', clearAllHistory);
    if (el.exportCsvBtn) el.exportCsvBtn.addEventListener('click', exportHistoryToCsv);
    if (el.historyFilterSelect) el.historyFilterSelect.addEventListener('change', renderMonitoringHistoryTable);
    if (el.historySearchInput) el.historySearchInput.addEventListener('input', renderMonitoringHistoryTable);
    if (el.retryMetricsBtn) el.retryMetricsBtn.addEventListener('click', fetchModelMetrics);
    if (el.downloadMetricsReportBtn) el.downloadMetricsReportBtn.addEventListener('click', downloadEvaluationReport);

    applyEnglishText();
    loadMonitoringRecords();
    fetchBackendStatus();
    window.setTimeout(fetchModelMetrics, 1200);
    window.addEventListener('focus', () => {
      // Throttle focus checks: check only if at least 10s elapsed since last check and none pending
      if (!state.backendStatus.request && (Date.now() - lastHealthCheckTime > 10000)) {
        fetchBackendStatus();
      }
    });
  });

  // Global handle for direct HTML interactions
  const nutriShieldApp = {
    switchView: switchView,
    deleteRecord: deleteRecord,
    inspectRecord: function (id) {
      const record = state.monitoringRecords.find(p => p.id === id);
      if (record) {
        state.lastPrediction = record;
        state.editingRecordId = record.id;
        setSex(String(record.sex).toLowerCase());
        if (el.inputAge) el.inputAge.value = record.age;
        if (el.inputHeight) el.inputHeight.value = record.height;
        if (el.inputWeight) el.inputWeight.value = record.weight;
        if (el.inputChildCode) el.inputChildCode.value = record.childCode || '';
        updateFormLiveBmi();
        switchView('predict');
        displayExplainableResult(record);
      }
    }
  };
  window.NutriShieldApp = nutriShieldApp;

})();
