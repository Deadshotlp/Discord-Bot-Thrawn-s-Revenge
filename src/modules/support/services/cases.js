const guildCaseStore = new Map();

function getGuildStore(guildId) {
  if (!guildCaseStore.has(guildId)) {
    guildCaseStore.set(guildId, {
      cases: new Map(),
      userCaseIndex: new Map()
    });
  }

  return guildCaseStore.get(guildId);
}

function generateCaseId() {
  const random = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${Date.now().toString(36)}-${random}`;
}

export function createSupportCase({ guildId, userId, departmentId, waitingChannelId, managementChannelId }) {
  const store = getGuildStore(guildId);
  const existingCaseId = store.userCaseIndex.get(userId);

  if (existingCaseId) {
    const existingCase = store.cases.get(existingCaseId);
    if (existingCase && existingCase.status !== "closed") {
      return { caseData: existingCase, created: false };
    }
  }

  const caseData = {
    id: generateCaseId(),
    guildId,
    userId,
    departmentId,
    waitingChannelId,
    managementChannelId,
    managementMessageId: "",
    status: "open",
    supporterId: "",
    talkChannelId: "",
    createdAt: Date.now(),
    actions: [{
      at: Date.now(),
      text: `Fall erstellt. Department: ${departmentId}`
    }]
  };

  store.cases.set(caseData.id, caseData);
  store.userCaseIndex.set(userId, caseData.id);
  return { caseData, created: true };
}

export function getSupportCase(guildId, caseId) {
  const store = getGuildStore(guildId);
  return store.cases.get(caseId) || null;
}

export function getUserActiveCase(guildId, userId) {
  const store = getGuildStore(guildId);
  const caseId = store.userCaseIndex.get(userId);
  if (!caseId) {
    return null;
  }

  const caseData = store.cases.get(caseId) || null;
  if (!caseData || caseData.status === "closed") {
    return null;
  }

  return caseData;
}

export function setCaseManagementMessage(guildId, caseId, messageId) {
  const caseData = getSupportCase(guildId, caseId);
  if (!caseData) {
    return null;
  }

  caseData.managementMessageId = messageId || "";
  return caseData;
}

export function claimSupportCase(guildId, caseId, supporterId, talkChannelId) {
  const caseData = getSupportCase(guildId, caseId);
  if (!caseData) {
    return null;
  }

  caseData.status = "claimed";
  caseData.supporterId = supporterId;
  caseData.talkChannelId = talkChannelId;
  caseData.claimedAt = Date.now();
  caseData.actions.push({
    at: Date.now(),
    text: `Fall geclaimed von ${supporterId}. Talk-Channel: ${talkChannelId}`
  });

  return caseData;
}

export function escalateSupportCase(guildId, caseId, departmentId, escalatedById) {
  const caseData = getSupportCase(guildId, caseId);
  if (!caseData) {
    return null;
  }

  caseData.departmentId = departmentId;
  caseData.actions.push({
    at: Date.now(),
    text: `Fall eskaliert von ${escalatedById} auf Department ${departmentId}`
  });

  return caseData;
}

export function closeSupportCase(guildId, caseId, closedById) {
  const store = getGuildStore(guildId);
  const caseData = store.cases.get(caseId) || null;

  if (!caseData) {
    return null;
  }

  caseData.status = "closed";
  caseData.closedAt = Date.now();
  caseData.actions.push({
    at: Date.now(),
    text: `Fall geschlossen von ${closedById}`
  });

  if (store.userCaseIndex.get(caseData.userId) === caseData.id) {
    store.userCaseIndex.delete(caseData.userId);
  }

  return caseData;
}

export function addSupportCaseAction(guildId, caseId, text) {
  const caseData = getSupportCase(guildId, caseId);
  if (!caseData) {
    return null;
  }

  caseData.actions.push({
    at: Date.now(),
    text: String(text || "")
  });

  return caseData;
}
