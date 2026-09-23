const SchoolSettings = require("../models/SchoolSettings");
const { logAction } = require("../utils/auditLog");

const DEFAULT_LECTURE_PERIODS = [
  { periodNo: 1, name: "Period 1", startTime: "8:30 AM", endTime: "9:15 AM" },
  { periodNo: 2, name: "Period 2", startTime: "9:15 AM", endTime: "10:00 AM" },
  { periodNo: 3, name: "Period 3", startTime: "10:20 AM", endTime: "11:05 AM" },
  { periodNo: 4, name: "Period 4", startTime: "11:05 AM", endTime: "11:50 AM" },
  { periodNo: 5, name: "Period 5", startTime: "12:30 PM", endTime: "1:15 PM" },
  { periodNo: 6, name: "Period 6", startTime: "1:15 PM", endTime: "2:00 PM" },
  { periodNo: 7, name: "Period 7", startTime: "2:00 PM", endTime: "2:45 PM" },
  { periodNo: 8, name: "Period 8", startTime: "2:45 PM", endTime: "3:30 PM" },
];

async function getOrCreate() {
  let settings = await SchoolSettings.findOne();
  if (!settings) {
    settings = await SchoolSettings.create({
      lecturePeriods: DEFAULT_LECTURE_PERIODS,
    });
  } else if (!settings.lecturePeriods || settings.lecturePeriods.length === 0) {
    settings.lecturePeriods = DEFAULT_LECTURE_PERIODS;
    await settings.save();
  }
  return settings;
}

async function getSettings(req, res) {
  res.json(await getOrCreate());
}

async function updateSettings(req, res) {
  const settings = await getOrCreate();
  const allowed = [
    "schoolName",
    "branchName",
    "branchAddress",
    "address",
    "contactEmail",
    "contactPhone",
    "academicYear",
    "affiliationNo",
    "lecturePeriods",
    "workingDays",
  ];
  for (const key of allowed) {
    if (key in req.body) settings[key] = req.body[key];
  }
  await settings.save();
  await logAction({
    req,
    entityType: "Settings",
    entityId: settings._id,
    action: "update",
    detail: req.body,
    note: "Updated school general settings",
  });
  res.json(settings);
}

// GET /api/settings/terms  — returns the full terms array
async function getTerms(req, res) {
  const settings = await getOrCreate();
  // Ensure there's always at least the two defaults
  const terms = settings.terms && settings.terms.length > 0
    ? settings.terms
    : ["term1", "term2"];
  res.json({ terms });
}

// POST /api/settings/terms  — body: { term: "Semester 1" }
async function addTerm(req, res) {
  const term = (req.body.term || "").toString().trim();
  if (!term) return res.status(400).json({ message: "Term label is required" });

  const settings = await getOrCreate();
  if (!settings.terms) settings.terms = [];
  if (settings.terms.includes(term)) {
    return res.status(409).json({ message: "Term already exists" });
  }
  settings.terms.push(term);
  await settings.save();
  await logAction({
    req,
    entityType: "Settings",
    entityId: settings._id,
    action: "create",
    detail: { term },
    note: `Added academic term: ${term}`,
  });
  res.json({ terms: settings.terms });
}

// DELETE /api/settings/terms/:term  — removes one term by its value
async function deleteTerm(req, res) {
  const term = decodeURIComponent(req.params.term || "").trim();
  const settings = await getOrCreate();
  if (!settings.terms) settings.terms = [];
  const idx = settings.terms.indexOf(term);
  if (idx === -1) return res.status(404).json({ message: "Term not found" });
  settings.terms.splice(idx, 1);
  await settings.save();
  await logAction({
    req,
    entityType: "Settings",
    entityId: settings._id,
    action: "delete",
    detail: { term },
    note: `Deleted academic term: ${term}`,
  });
  res.json({ terms: settings.terms });
}

module.exports = { getSettings, updateSettings, getTerms, addTerm, deleteTerm };
