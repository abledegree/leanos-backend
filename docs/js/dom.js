const jobInput = document.getElementById("jobInput");
const startJobButton = document.getElementById("startJobButton");

const materialQty = document.getElementById("materialQty");
const addMaterialButton = document.getElementById("addMaterialButton");
const materialJobSelect = document.getElementById("materialJobSelect");
const materialItemSelect = document.getElementById("materialItemSelect");

const closeJobSelect = document.getElementById("closeJobSelect");
const closeJobButton = document.getElementById("closeJobButton");

const inventoryName = document.getElementById("inventoryName");
const inventoryGroup = document.getElementById("inventoryGroup");
const inventoryCode = document.getElementById("inventoryCode");
const inventoryUnit = document.getElementById("inventoryUnit");
const inventoryThreshold = document.getElementById("inventoryThreshold");
const addInventoryButton = document.getElementById("addInventoryButton");

const openAddInventoryModalButton = document.getElementById("openAddInventoryModalButton");
const addInventoryModal = document.getElementById("addInventoryModal");
const closeAddInventoryModalButton = document.getElementById("closeAddInventoryModalButton");

const receiptItemSearch = document.getElementById("receiptItemSearch");
const receiptItemDatalist = document.getElementById("receiptItemDatalist");
const receiptQty = document.getElementById("receiptQty");
const receiveInventoryButton = document.getElementById("receiveInventoryButton");

const adjustItemSearch = document.getElementById("adjustItemSearch");
const adjustItemDatalist = document.getElementById("adjustItemDatalist");
const adjustQty = document.getElementById("adjustQty");
const adjustNote = document.getElementById("adjustNote");
const adjustInventoryButton = document.getElementById("adjustInventoryButton");

const inventoryList = document.getElementById("inventoryList");
const inventoryAlerts = document.getElementById("inventoryAlerts");
const inventorySearchInput = document.getElementById("inventorySearchInput");

const toggleInventorySnapshotButton = document.getElementById("toggleInventorySnapshotButton");
const inventorySnapshotContent = document.getElementById("inventorySnapshotContent");

const openReorderDraftModalButton = document.getElementById("openReorderDraftModalButton");
const closeReorderDraftModalButton = document.getElementById("closeReorderDraftModalButton");
const reorderDraftModal = document.getElementById("reorderDraftModal");
const toggleReorderNoticesButton = document.getElementById("toggleReorderNoticesButton");

const generateReorderDraftButton = document.getElementById("generateReorderDraftButton");
const markReorderRequestedButton = document.getElementById("markReorderRequestedButton");
const reorderDraftOutput = document.getElementById("reorderDraftOutput");

const jobFilterSelect = document.getElementById("jobFilterSelect");
const jobSearchInput = document.getElementById("jobSearchInput");
const openJobList = document.getElementById("openJobList");
const closedJobList = document.getElementById("closedJobList");

const toggleOpenJobsButton = document.getElementById("toggleOpenJobsButton");
const toggleClosedJobsButton = document.getElementById("toggleClosedJobsButton");
const openJobSectionContent = document.getElementById("openJobSectionContent");
const closedJobSectionContent = document.getElementById("closedJobSectionContent");

const dashboardReorders = document.getElementById("dashboardReorders");
const dashboardStats = document.getElementById("dashboardStats");
const dashboardMaterials = document.getElementById("dashboardMaterials");
const toggleDashboardReordersButton = document.getElementById("toggleDashboardReordersButton");
const toggleDashboardMaterialsButton = document.getElementById("toggleDashboardMaterialsButton");
const dashboardReordersContent = document.getElementById("dashboardReordersContent");
const dashboardMaterialsContent = document.getElementById("dashboardMaterialsContent");

const transactionSearchInput = document.getElementById("transactionSearchInput");
const transactionList = document.getElementById("transactionList");

const syncStatus = document.getElementById("syncStatus");
const syncNowButton = document.getElementById("syncNowButton");
const exportDataButton = document.getElementById("exportDataButton");
const importDataInput = document.getElementById("importDataInput");
const useCloudVersionButton = document.getElementById("useCloudVersionButton");

const menuToggleButton = document.getElementById("menuToggleButton");
const topMenu = document.getElementById("topMenu");

const jobEditModal = document.getElementById("jobEditModal");
const closeJobEditModalButton = document.getElementById("closeJobEditModalButton");
const editJobTicketInput = document.getElementById("editJobTicketInput");
const editJobStatusSelect = document.getElementById("editJobStatusSelect");
const editJobStartedAtInput = document.getElementById("editJobStartedAtInput");
const editJobClosedAtInput = document.getElementById("editJobClosedAtInput");
const editJobNotesInput = document.getElementById("editJobNotesInput");
const saveJobEditButton = document.getElementById("saveJobEditButton");
const deleteJobFromModalButton = document.getElementById("deleteJobFromModalButton");
const editJobMaterialsList = document.getElementById("editJobMaterialsList");

const jobMaterialModal = document.getElementById("jobMaterialModal");
const closeJobMaterialModalButton = document.getElementById("closeJobMaterialModalButton");
const jobMaterialModalLabel = document.getElementById("jobMaterialModalLabel");
const jobMaterialLines = document.getElementById("jobMaterialLines");
const addMaterialLineButton = document.getElementById("addMaterialLineButton");
const saveJobMaterialButton = document.getElementById("saveJobMaterialButton");
