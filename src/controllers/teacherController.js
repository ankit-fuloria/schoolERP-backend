const bcrypt = require("bcryptjs");
const Teacher = require("../models/Teacher");
const User = require("../models/User");
const Subject = require("../models/Subject");
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
  "employeeId", "staffType", "highestQualification", "department", "designation", "employmentRole",
  "dateOfJoining", "employmentCountry", "employmentState", "workLocation", "natureOfEmployment",
  "attendanceCode", "transportAttendanceCode", "esiNumber", "epfNumber", "uan", "reportingTo",
  "rolesAndResponsibilities", "signatureDocumentUrl",
];

function detailValues(source) {
  return Object.fromEntries(
    DETAIL_FIELDS.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])
  );
}

async function validateAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];
  const cleaned = assignments
    .filter((assignment) => assignment?.classId && assignment?.subject)
    .map((assignment) => ({ classId: assignment.classId, subject: assignment.subject.trim() }));

  for (const assignment of cleaned) {
    const subject = await Subject.findOne({
      name: assignment.subject,
      classIds: assignment.classId,
      status: { $ne: "inactive" },
    });
    if (!subject) {
      throw new Error(`${assignment.subject} is not mapped to the selected class`);
    }
  }
  return cleaned;
}

function serializeTeacher(t) {
  return {
    id: t._id,
    name: t.name,
    firstName: t.firstName,
    middleName: t.middleName,
    lastName: t.lastName,
    dateOfBirth: t.dateOfBirth,
    gender: t.gender,
    bloodGroup: t.bloodGroup,
    hasDisability: t.hasDisability,
    disabilityType: t.disabilityType,
    disabilityDocumentUrl: t.disabilityDocumentUrl,
    phone: t.phone,
    emergencyContact: t.emergencyContact,
    idProofType: t.idProofType,
    idProofDocumentUrl: t.idProofDocumentUrl,
    qualification: t.qualification,
    yearsOfExperience: t.yearsOfExperience,
    previousOrganization: t.previousOrganization,
    previousDesignation: t.previousDesignation,
    educationProofDocumentUrl: t.educationProofDocumentUrl,
    otherDocumentUrl: t.otherDocumentUrl,
    ...detailValues(t),
    subject: t.subject,
    classAssigned: t.classAssigned,
    email: t.email,
    joinDate: t.joinDate,
    status: t.status,
    hasLogin: !!t.userId,
    assignments: (t.assignments || []).map((a) => ({
      classId: a.classId?._id || a.classId,
      className: a.classId?.name,
      subject: a.subject,
    })),
  };
}

async function list(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10));
  const { search, includeInactive, status } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (status) {
    filter.status = status;
  } else if (!includeInactive) {
    filter.status = { $ne: "inactive" };
  }

  const [items, total] = await Promise.all([
    Teacher.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("assignments.classId", "name grade section"),
    Teacher.countDocuments(filter),
  ]);

  res.json({
    items: items.map(serializeTeacher),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

async function create(req, res) {
  const {
    firstName,
    middleName,
    lastName,
    subject,
    classAssigned,
    email,
    phone,
    password,
    assignments,
  } = req.body;
  const name = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
  if (!firstName || !subject || !email || !phone || !password) {
    return res.status(400).json({
      message: "first name, subject, phone, email and password are required",
    });
  }

  let validAssignments;
  try {
    validAssignments = await validateAssignments(assignments);
  } catch (error) {
    return res.status(400).json({ message: error.message });
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
    role: "teacher",
  });

  const teacher = await Teacher.create({
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
    subject,
    classAssigned,
    email: email.toLowerCase(),
    userId: user._id,
    assignments: validAssignments,
    ...detailValues(req.body),
  });

  const populated = await Teacher.findById(teacher._id).populate(
    "assignments.classId",
    "name grade section"
  );
  await logAction({
    req,
    entityType: "Teacher",
    entityId: teacher._id,
    action: "create",
    detail: redactSecrets(req.body),
  });
  res.status(201).json(serializeTeacher(populated));
}

async function update(req, res) {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) {
    return res.status(404).json({ message: "Teacher not found" });
  }

  const { name, subject, classAssigned, assignments, status } = req.body;
  let validAssignments;
  if (assignments !== undefined) {
    try {
      validAssignments = await validateAssignments(assignments);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  }
  if (name !== undefined) teacher.name = name;
  if (subject !== undefined) teacher.subject = subject;
  if (classAssigned !== undefined) teacher.classAssigned = classAssigned;
  if (validAssignments !== undefined) teacher.assignments = validAssignments;
  if (status !== undefined) teacher.status = status;
  Object.assign(teacher, detailValues(req.body));
  if (req.body.hasDisability === false) {
    teacher.disabilityType = undefined;
    teacher.disabilityDocumentUrl = undefined;
  }
  if (req.body.firstName !== undefined || req.body.middleName !== undefined || req.body.lastName !== undefined) {
    teacher.name = [teacher.firstName, teacher.middleName, teacher.lastName].filter(Boolean).join(" ").trim();
  }
  await teacher.save();

  if (teacher.userId && status !== undefined) {
    await User.findByIdAndUpdate(teacher.userId, { active: status !== "inactive" });
  }
  if (teacher.userId) {
    await User.findByIdAndUpdate(teacher.userId, {
      name: teacher.name,
      email: teacher.email,
      phone: teacher.phone,
    });
  }

  const populated = await Teacher.findById(teacher._id).populate(
    "assignments.classId",
    "name grade section"
  );
  await logAction({
    req,
    entityType: "Teacher",
    entityId: teacher._id,
    action: "update",
    detail: redactSecrets(req.body),
  });
  res.json(serializeTeacher(populated));
}

// "Delete" only disables the teacher (status: inactive) and, if they have a
// portal login, blocks that login too. Nothing is ever hard-deleted.
async function disable(req, res) {
  const teacher = await Teacher.findByIdAndUpdate(
    req.params.id,
    { status: "inactive" },
    { new: true }
  ).populate("assignments.classId", "name grade section");
  if (!teacher) {
    return res.status(404).json({ message: "Teacher not found" });
  }
  if (teacher.userId) {
    await User.findByIdAndUpdate(teacher.userId, { active: false });
  }
  await logAction({ req, entityType: "Teacher", entityId: teacher._id, action: "disable" });
  res.json(serializeTeacher(teacher));
}

async function uploadTeacherDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "A document file is required" });
  }
  res.status(201).json({
    fileName: req.file.originalname,
    documentUrl: `/uploads/teacher-documents/${req.file.filename}`,
  });
}

module.exports = { list, create, update, disable, uploadTeacherDocument };
