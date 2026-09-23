const bcrypt = require("bcryptjs");
const Staff = require("../models/Staff");
const User = require("../models/User");
const { logAction, redactSecrets } = require("../utils/auditLog");

const DETAIL_FIELDS = [
  "firstName", "middleName", "lastName", "dateOfBirth", "gender", "bloodGroup",
  "hasDisability", "disabilityType", "disabilityDocumentUrl", "phone", "emergencyContact",
  "countryCode", "landline", "emergencyContactName", "emergencyContactPhone",
  "presentAddress", "permanentAddress", "father", "mother", "spouse", "maritalStatus",
  "weddingDate", "nationality", "religion", "motherTongue", "panNumber", "bankName",
  "bankAccountNumber", "bankIfscCode", "iban", "branchAddress", "routingNumberOrAgentId",
  "about", "idProofType", "idProofDocumentUrl", "qualification", "yearsOfExperience",
  "previousOrganization", "previousDesignation", "educationProofDocumentUrl", "otherDocumentUrl",
  "employeeId", "staffType", "highestQualification", "designation", "employmentRole",
  "dateOfJoining", "employmentCountry", "employmentState", "workLocation", "natureOfEmployment",
  "attendanceCode", "transportAttendanceCode", "esiNumber", "epfNumber", "uan", "reportingTo",
  "rolesAndResponsibilities", "signatureDocumentUrl",
];

function detailValues(source) {
  return Object.fromEntries(
    DETAIL_FIELDS.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])
  );
}

function cleanPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return permissions
    .map((p) => String(p).trim())
    .filter((p) => Staff.PERMISSION_KEYS.includes(p));
}

function serializeStaff(s) {
  return {
    id: s._id,
    name: s.name,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    dateOfBirth: s.dateOfBirth,
    gender: s.gender,
    bloodGroup: s.bloodGroup,
    hasDisability: s.hasDisability,
    disabilityType: s.disabilityType,
    disabilityDocumentUrl: s.disabilityDocumentUrl,
    phone: s.phone,
    emergencyContact: s.emergencyContact,
    idProofType: s.idProofType,
    idProofDocumentUrl: s.idProofDocumentUrl,
    qualification: s.qualification,
    yearsOfExperience: s.yearsOfExperience,
    previousOrganization: s.previousOrganization,
    previousDesignation: s.previousDesignation,
    educationProofDocumentUrl: s.educationProofDocumentUrl,
    otherDocumentUrl: s.otherDocumentUrl,
    ...detailValues(s),
    department: s.department,
    permissions: s.permissions || [],
    email: s.email,
    joinDate: s.joinDate,
    status: s.status,
    hasLogin: !!s.userId,
  };
}

// Department is free text on Staff, not a separate collection — this just
// lists distinct values already in use so the admin UI can offer them as
// suggestions (cutting down on typo'd duplicates) while still allowing a
// brand new department name to be typed.
async function listDepartments(req, res) {
  const departments = await Staff.distinct("department");
  res.json({ departments: departments.filter(Boolean).sort((a, b) => a.localeCompare(b)) });
}

async function list(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10));
  const { search, includeInactive, status } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { department: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (status) {
    filter.status = status;
  } else if (!includeInactive) {
    filter.status = { $ne: "inactive" };
  }

  const [items, total] = await Promise.all([
    Staff.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Staff.countDocuments(filter),
  ]);

  res.json({
    items: items.map(serializeStaff),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

async function create(req, res) {
  const { firstName, middleName, lastName, department, email, phone, password, permissions } =
    req.body;
  const name = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
  if (!firstName || !department || !email || !phone || !password) {
    return res.status(400).json({
      message: "first name, department, phone, email and password are required",
    });
  }

  const existing = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { phone }],
  });
  if (existing) {
    return res.status(400).json({ message: "That email or phone number is already in use" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone,
    passwordHash,
    role: "staff",
  });

  const staff = await Staff.create({
    name,
    firstName,
    middleName,
    lastName,
    dateOfBirth: req.body.dateOfBirth,
    gender: req.body.gender,
    bloodGroup: req.body.bloodGroup,
    hasDisability: req.body.hasDisability === true,
    disabilityType: req.body.hasDisability === true ? req.body.disabilityType : undefined,
    disabilityDocumentUrl:
      req.body.hasDisability === true ? req.body.disabilityDocumentUrl : undefined,
    phone,
    emergencyContact: req.body.emergencyContact,
    idProofType: req.body.idProofType,
    idProofDocumentUrl: req.body.idProofDocumentUrl,
    qualification: req.body.qualification,
    yearsOfExperience: req.body.yearsOfExperience,
    previousOrganization: req.body.previousOrganization,
    previousDesignation: req.body.previousDesignation,
    educationProofDocumentUrl: req.body.educationProofDocumentUrl,
    otherDocumentUrl: req.body.otherDocumentUrl,
    department,
    permissions: cleanPermissions(permissions),
    email: email.toLowerCase(),
    userId: user._id,
    ...detailValues(req.body),
  });

  await logAction({
    req,
    entityType: "Staff",
    entityId: staff._id,
    action: "create",
    detail: redactSecrets(req.body),
  });
  res.status(201).json(serializeStaff(staff));
}

async function update(req, res) {
  const staff = await Staff.findById(req.params.id);
  if (!staff) {
    return res.status(404).json({ message: "Staff member not found" });
  }

  const { name, department, permissions, status, email } = req.body;
  if (name !== undefined) staff.name = name;
  if (department !== undefined) staff.department = department;
  if (permissions !== undefined) staff.permissions = cleanPermissions(permissions);
  if (status !== undefined) staff.status = status;
  if (email !== undefined) staff.email = email ? email.toLowerCase() : staff.email;
  Object.assign(staff, detailValues(req.body));
  if (req.body.hasDisability === false) {
    staff.disabilityType = undefined;
    staff.disabilityDocumentUrl = undefined;
  }
  if (req.body.firstName !== undefined || req.body.middleName !== undefined || req.body.lastName !== undefined) {
    staff.name = [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(" ").trim();
  }
  await staff.save();

  if (req.body.password && staff.userId) {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await User.findByIdAndUpdate(staff.userId, { passwordHash });
  }
  if (staff.userId && status !== undefined) {
    await User.findByIdAndUpdate(staff.userId, { active: status !== "inactive" });
  }
  if (staff.userId) {
    await User.findByIdAndUpdate(staff.userId, {
      name: staff.name,
      email: staff.email,
      phone: staff.phone,
    });
  }

  await logAction({
    req,
    entityType: "Staff",
    entityId: staff._id,
    action: "update",
    detail: redactSecrets(req.body),
  });
  res.json(serializeStaff(staff));
}

// "Delete" only disables the staff member (status: inactive) and blocks
// their portal login too. Nothing is ever hard-deleted.
async function disable(req, res) {
  const staff = await Staff.findByIdAndUpdate(
    req.params.id,
    { status: "inactive" },
    { new: true }
  );
  if (!staff) {
    return res.status(404).json({ message: "Staff member not found" });
  }
  if (staff.userId) {
    await User.findByIdAndUpdate(staff.userId, { active: false });
  }
  await logAction({ req, entityType: "Staff", entityId: staff._id, action: "disable" });
  res.json(serializeStaff(staff));
}

async function uploadStaffDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "A document file is required" });
  }
  res.status(201).json({
    fileName: req.file.originalname,
    documentUrl: `/uploads/staff-documents/${req.file.filename}`,
  });
}

module.exports = { list, listDepartments, create, update, disable, uploadStaffDocument };
