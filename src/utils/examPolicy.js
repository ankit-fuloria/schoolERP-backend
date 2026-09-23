function ensure(condition, message, status = 400) {
  if (!condition) { const error = new Error(message); error.status = status; throw error; }
}
const same = (a, b) => String(a?._id || a) === String(b?._id || b);
function validateStructures(structures) {
  ensure(Array.isArray(structures) && structures.length > 0, "Add at least one exam structure");
  const grades = new Set();
  const structureIds = new Set(), sessionIds = new Set();
  for (const structure of structures) {
    if (structure._id) {
      ensure(!structureIds.has(String(structure._id)), "Duplicate structure id");
      structureIds.add(String(structure._id));
    }
    ensure(structure.name?.trim(), "Every structure needs a name");
    ensure(structure.sessions?.length > 0, "Every structure needs exam sessions");
    ensure(structure.sessions.filter(s => s.type === "final").length === 1,
      "Each structure must contain exactly one final session");
    const names = new Set();
    for (const session of structure.sessions) {
      if (session._id) {
        ensure(!sessionIds.has(String(session._id)), "Duplicate session id");
        sessionIds.add(String(session._id));
      }
      ensure(session.name?.trim(), "Every session needs a name");
      ensure(!names.has(session.name.trim().toLowerCase()), "Session names must be unique within a structure");
      names.add(session.name.trim().toLowerCase());
      ensure(["final", "mid", "sessional"].includes(session.type), "Invalid exam session type");
      ensure(typeof session.maxMarks === "number" && Number.isFinite(session.maxMarks) && session.maxMarks > 0,
        "Maximum marks must be greater than zero");
      ensure(typeof session.passMarks === "number" && Number.isFinite(session.passMarks) &&
        session.passMarks >= 0 && session.passMarks <= session.maxMarks, "Pass marks must be between zero and maximum marks");
    }
    for (const grade of structure.grades || []) {
      ensure(typeof grade === "string" && grade.trim(), "Invalid class grade");
      ensure(!grades.has(grade), `Class ${grade} can belong to only one structure`);
      grades.add(grade);
    }
  }
}
function validateMarks(rows, students, maxMarks, complete = false) {
  ensure(Array.isArray(rows) && (rows.length > 0 || (complete && students.length === 0)), "Add student marks");
  const ids = new Set();
  for (const row of rows) {
    ensure(students.some(s => same(s.studentId, row.studentId)), "Student is not in this exam roster");
    ensure(!ids.has(String(row.studentId)), "Duplicate student result");
    ids.add(String(row.studentId));
    ensure(typeof row.marksObtained === "number" && Number.isFinite(row.marksObtained) &&
      row.marksObtained >= 0 && row.marksObtained <= maxMarks, `Marks must be between 0 and ${maxMarks}`);
    ensure(typeof row.grade === "string" && row.grade.trim().length > 0 && row.grade.length <= 20,
      "A grade is required for every mark");
  }
  if (complete) ensure(ids.size === students.length, "Enter marks and grades for every student before submitting");
}
const gradeOrder = ["Nursery", "LKG", "UKG", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];
function nextGrade(grade) { const index = gradeOrder.indexOf(grade); return index >= 0 ? gradeOrder[index + 1] : undefined; }
module.exports = { ensure, same, validateStructures, validateMarks, nextGrade, gradeOrder };
