const GRADE_BANDS = [
  { label: "Nursery - 5th", classPrefixes: ["Nursery", "LKG", "UKG", "1st", "2nd", "3rd", "4th", "5th"] },
  { label: "6th - 8th", classPrefixes: ["6th", "7th", "8th"] },
  { label: "9th - 10th", classPrefixes: ["9th", "10th"] },
  { label: "11th - 12th", classPrefixes: ["11th", "12th"] },
];

function gradeBandFor(grade) {
  const band = GRADE_BANDS.find((b) => b.classPrefixes.includes(grade));
  return band ? band.label : "Unassigned";
}

module.exports = { GRADE_BANDS, gradeBandFor };
