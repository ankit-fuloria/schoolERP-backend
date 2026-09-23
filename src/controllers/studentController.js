const Student = require("../models/Student");
const SchoolClass = require("../models/SchoolClass");
const DisabilityOption = require("../models/DisabilityOption");
const ReservationOption = require("../models/ReservationOption");
const { logAction } = require("../utils/auditLog");

function normalizeStudentPayload(body) {
  const hasDisability = body.hasDisability === true;
  const hasReservation = body.hasReservation === true;
  const parentDashboardPhoneType = body.parentDashboardPhoneType;
  const parentDashboardPhone =
    parentDashboardPhoneType === "father"
      ? body.fatherPhone
      : parentDashboardPhoneType === "mother"
        ? body.motherPhone
        : undefined;

  return {
    rollNo: body.rollNo,
    gender: body.gender,
    dateOfBirth: body.dateOfBirth,
    bloodGroup: body.bloodGroup,
    category: body.category || "General",
    hasDisability,
    disabilityType: hasDisability ? body.disabilityType : undefined,
    disabilityDocumentUrl: hasDisability ? body.disabilityDocumentUrl : undefined,
    hasReservation,
    reservationType: hasReservation ? body.reservationType : undefined,
    reservationDocumentUrls: hasReservation ? body.reservationDocumentUrls || [] : [],
    address: body.address,
    studentAddress: body.studentAddress,
    profileImageUrl: body.profileImageUrl,
    fatherName: body.fatherDetails?.name || body.fatherName,
    fatherPhone: body.fatherDetails?.primaryPhone || body.fatherPhone,
    motherName: body.motherDetails?.name || body.motherName,
    motherPhone: body.motherDetails?.primaryPhone || body.motherPhone,
    fatherDetails: body.fatherDetails,
    motherDetails: body.motherDetails,
    primaryContactRelation: body.primaryContactRelation,
    enquirySource: body.enquirySource,
    additionalInformation: body.additionalInformation,
    remark: body.remark,
    previousSchool: body.previousSchool,
    parentDashboardPhoneType,
    parentDashboardPhone,
    emergencyContactName: body.emergencyContactName,
    emergencyContactPhone: body.emergencyContactPhone,
    // Government & Board Identification
    studentPan: body.studentPan,
    delhiGovStudentId: body.delhiGovStudentId,
    cbseId: body.cbseId,
    // Transport & Pickup
    modeOfTransport: body.modeOfTransport,
    bachaCollectorName: body.bachaCollectorName,
    // Certificates & Documents
    birthCertificateUrl: body.birthCertificateUrl,
    birthCertificateName: body.birthCertificateName,
    transferCertificateUrl: body.transferCertificateUrl,
    transferCertificateName: body.transferCertificateName,
    previousReportCardUrl: body.previousReportCardUrl,
    previousReportCardName: body.previousReportCardName,
    siblingIds: body.siblingIds || [],
    admissionDate: body.admissionDate || new Date(),
  };
}

function serializeStudent(s) {
  return {
    id: s._id,
    name: s.name,
    admissionNo: s.admissionNo,
    class: s.classId
      ? {
          id: s.classId._id,
          name: s.classId.name,
          grade: s.classId.grade,
          section: s.classId.section,
          gradeBand: s.classId.gradeBand,
        }
      : null,
    rollNo: s.rollNo,
    gender: s.gender,
    dateOfBirth: s.dateOfBirth,
    bloodGroup: s.bloodGroup,
    category: s.category,
    hasDisability: s.hasDisability,
    disabilityType: s.disabilityType,
    disabilityDocumentUrl: s.disabilityDocumentUrl,
    hasReservation: s.hasReservation,
    reservationType: s.reservationType,
    reservationDocumentUrls: s.reservationDocumentUrls || [],
    address: s.address,
    studentAddress: s.studentAddress,
    profileImageUrl: s.profileImageUrl,
    fatherName: s.fatherName,
    fatherPhone: s.fatherPhone,
    motherName: s.motherName,
    motherPhone: s.motherPhone,
    fatherDetails: s.fatherDetails,
    motherDetails: s.motherDetails,
    primaryContactRelation: s.primaryContactRelation,
    enquirySource: s.enquirySource,
    additionalInformation: s.additionalInformation,
    remark: s.remark,
    previousSchool: s.previousSchool,
    parentDashboardPhoneType: s.parentDashboardPhoneType,
    parentDashboardPhone: s.parentDashboardPhone,
    emergencyContactName: s.emergencyContactName,
    emergencyContactPhone: s.emergencyContactPhone,
    // Government & Board Identification
    studentPan: s.studentPan,
    delhiGovStudentId: s.delhiGovStudentId,
    cbseId: s.cbseId,
    // Transport & Pickup
    modeOfTransport: s.modeOfTransport,
    bachaCollectorName: s.bachaCollectorName,
    // Certificates & Documents
    birthCertificateUrl: s.birthCertificateUrl,
    birthCertificateName: s.birthCertificateName,
    transferCertificateUrl: s.transferCertificateUrl,
    transferCertificateName: s.transferCertificateName,
    previousReportCardUrl: s.previousReportCardUrl,
    previousReportCardName: s.previousReportCardName,
    siblingIds: s.siblingIds,
    admissionDate: s.admissionDate,
    status: s.status,
    attendancePercent: s.attendancePercent,
    performancePercent: s.performancePercent,
  };
}

async function listStudents(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const { search, classId, gradeBand, status, includeInactive, ids } = req.query;

  const filter = {};
  if (ids) {
    filter._id = { $in: ids.split(",").map((id) => id.trim()).filter(Boolean) };
  }
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { admissionNo: { $regex: search, $options: "i" } },
      { fatherPhone: { $regex: search, $options: "i" } },
      { motherPhone: { $regex: search, $options: "i" } },
    ];
  }
  if (classId) filter.classId = classId;
  if (status) {
    filter.status = status;
  } else if (!includeInactive) {
    filter.status = { $ne: "inactive" };
  }

  if (gradeBand) {
    const classesInBand = await SchoolClass.find({ gradeBand }).select("_id");
    filter.classId = { $in: classesInBand.map((c) => c._id) };
  }

  const [students, total] = await Promise.all([
    Student.find(filter)
      .populate("classId", "name grade section gradeBand")
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Student.countDocuments(filter),
  ]);

  res.json({
    students: students.map(serializeStudent),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

async function getStudentSummary(req, res) {
  const [total, active, gradeBandAgg] = await Promise.all([
    Student.countDocuments(),
    Student.countDocuments({ status: "active" }),
    Student.aggregate([
      { $match: { attendancePercent: { $gt: 0 } } },
      { $group: { _id: null, avgAttendance: { $avg: "$attendancePercent" } } },
    ]),
  ]);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const newAdmissions = await Student.countDocuments({ admissionDate: { $gte: thirtyDaysAgo } });

  res.json({
    total,
    active,
    newAdmissions,
    avgAttendance: gradeBandAgg[0] ? Math.round(gradeBandAgg[0].avgAttendance) : 0,
  });
}

async function createStudent(req, res) {
  const { name, admissionNo, classId } = req.body;
  if (!name || !admissionNo || !classId) {
    return res.status(400).json({ message: "name, admissionNo and classId are required" });
  }

  const schoolClass = await SchoolClass.findById(classId);
  if (!schoolClass) {
    return res.status(400).json({ message: "Selected class does not exist" });
  }

  const existing = await Student.findOne({ admissionNo });
  if (existing) {
    return res.status(400).json({ message: "Admission number already in use" });
  }

  const student = await Student.create({
    name,
    admissionNo,
    classId,
    ...normalizeStudentPayload(req.body),
  });

  if (req.body.siblingIds && req.body.siblingIds.length) {
    await Student.updateMany(
      { _id: { $in: req.body.siblingIds } },
      { $addToSet: { siblingIds: student._id } }
    );
  }

  await SchoolClass.updateOne({ _id: classId }, { $inc: { studentCount: 1 } });

  const populated = await Student.findById(student._id).populate(
    "classId",
    "name grade section gradeBand"
  );
  await logAction({
    req,
    entityType: "Student",
    entityId: student._id,
    action: "create",
    detail: { name: student.name, admissionNo: student.admissionNo, classId },
  });
  res.status(201).json(serializeStudent(populated));
}

// "Delete" only disables the student (status: inactive) — records are never
// hard-deleted so fee/attendance/sibling history stays intact.
async function disableStudent(req, res) {
  const student = await Student.findByIdAndUpdate(
    req.params.id,
    { status: "inactive" },
    { new: true }
  ).populate("classId", "name grade section gradeBand");
  if (!student) {
    return res.status(404).json({ message: "Student not found" });
  }
  await logAction({ req, entityType: "Student", entityId: student._id, action: "disable" });
  res.json(serializeStudent(student));
}

async function updateStudent(req, res) {
  const body = { ...req.body };
  if (
    "hasDisability" in body || "hasReservation" in body || "parentDashboardPhoneType" in body ||
    "fatherDetails" in body || "motherDetails" in body
  ) {
    Object.assign(body, normalizeStudentPayload(body));
  }

  const student = await Student.findByIdAndUpdate(req.params.id, body, {
    new: true,
  }).populate("classId", "name grade section gradeBand");
  if (!student) {
    return res.status(404).json({ message: "Student not found" });
  }
  await logAction({
    req,
    entityType: "Student",
    entityId: student._id,
    action: "update",
    detail: req.body,
  });
  res.json(serializeStudent(student));
}

async function listDisabilityOptions(req, res) {
  const options = await DisabilityOption.find().sort({ name: 1 });
  res.json({ options: options.map((o) => ({ id: o._id, name: o.name })) });
}

async function createDisabilityOption(req, res) {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const option = await DisabilityOption.findOneAndUpdate(
    { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    { $setOnInsert: { name } },
    { new: true, upsert: true }
  );

  res.status(201).json({ id: option._id, name: option.name });
}

async function listReservationOptions(req, res) {
  const options = await ReservationOption.find().sort({ name: 1 });
  res.json({ options: options.map((o) => ({ id: o._id, name: o.name })) });
}

async function createReservationOption(req, res) {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const option = await ReservationOption.findOneAndUpdate(
    { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    { $setOnInsert: { name } },
    { new: true, upsert: true }
  );

  res.status(201).json({ id: option._id, name: option.name });
}

async function uploadStudentDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "document is required" });
  }

  res.status(201).json({
    fileName: req.file.originalname,
    documentUrl: `/uploads/student-documents/${req.file.filename}`,
  });
}

module.exports = {
  listStudents,
  getStudentSummary,
  createStudent,
  disableStudent,
  updateStudent,
  listDisabilityOptions,
  createDisabilityOption,
  listReservationOptions,
  createReservationOption,
  uploadStudentDocument,
};
