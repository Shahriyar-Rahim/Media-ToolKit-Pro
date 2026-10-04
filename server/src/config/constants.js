// Feature keys are the only place tool names live. Plans/free-access map to these; nothing checks plan names.
const FEATURES = ['videoCompression', 'hardwareAcceleration', 'maximumCompression', 'audioConversion', 'heicConversion',
  'pdfCreate', 'pdfMerge', 'batchProcessing', 'mediaVault', 'priorityProcessing', 'advancedSettings'];
const ROLES = ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'];
const SUB_STATUS = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REJECTED', 'REFUNDED'];
module.exports = { FEATURES, ROLES, SUB_STATUS };
