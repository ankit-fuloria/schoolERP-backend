require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Subject = require("../src/models/Subject");
const LibraryBook = require("../src/models/LibraryBook");
const SchoolClass = require("../src/models/SchoolClass");

const BOOKS_DATA = [
  // --- Mathematics ---
  {
    title: "NCERT Mathematics Grade 6",
    author: "NCERT",
    isbn: "978-81-7450-482-1",
    category: "Mathematics",
    totalCopies: 45,
    availableCopies: 42,
    chapters: [
      { name: "Knowing Our Numbers", description: "Comparing numbers, place values, estimation", topics: ["Place Value System", "Large Numbers", "Estimation"], term: "term1" },
      { name: "Whole Numbers", description: "Properties of whole numbers, number line", topics: ["Predecessor & Successor", "Properties of Addition", "Patterns in Whole Numbers"], term: "term1" },
      { name: "Playing with Numbers", description: "Factors, multiples, prime & composite numbers, HCF & LCM", topics: ["Factors and Multiples", "Prime Factorisation", "HCF and LCM"], term: "term1" },
      { name: "Basic Geometrical Ideas", description: "Points, lines, curves, polygons, angles, triangles, circles", topics: ["Lines and Rays", "Polygons and Triangles", "Circles and Chords"], term: "term1" },
      { name: "Fractions & Decimals", description: "Types of fractions, operations, decimal representations", topics: ["Proper & Improper Fractions", "Adding Fractions", "Decimals on Number Line"], term: "term2" },
      { name: "Algebra & Ratio", description: "Introduction to variables, equations, ratio and proportion", topics: ["Variables and Expressions", "Writing Equations", "Ratios and Unitary Method"], term: "term2" },
    ],
  },
  {
    title: "NCERT Mathematics Grade 9",
    author: "NCERT",
    isbn: "978-81-7450-708-2",
    category: "Mathematics",
    totalCopies: 50,
    availableCopies: 48,
    chapters: [
      { name: "Number Systems", description: "Irrational numbers, real numbers, laws of exponents", topics: ["Irrational Numbers", "Rationalising Denominators", "Exponents for Real Numbers"], term: "term1" },
      { name: "Polynomials", description: "Degree of polynomials, remainder theorem, factorisation", topics: ["Degrees of Polynomials", "Remainder Theorem", "Algebraic Identities"], term: "term1" },
      { name: "Coordinate Geometry", description: "Cartesian plane, coordinates of points", topics: ["Cartesian Plane", "Plotting Points", "Quadrant Rules"], term: "term1" },
      { name: "Linear Equations in Two Variables", description: "Solutions, graph of linear equations", topics: ["Solutions of Equations", "Graphing Linear Equations", "Equations Parallel to Axes"], term: "term1" },
      { name: "Triangles & Quadrilaterals", description: "Congruence rules, properties of parallelograms", topics: ["SAS/SSS Congruence", "Mid-point Theorem", "Parallelogram Properties"], term: "term2" },
      { name: "Statistics & Probability", description: "Bar graphs, histograms, frequency polygons, empirical probability", topics: ["Frequency Tables", "Histograms", "Experimental Probability"], term: "term2" },
    ],
  },
  {
    title: "NCERT Mathematics Grade 10",
    author: "NCERT",
    isbn: "978-81-7450-634-4",
    category: "Mathematics",
    totalCopies: 60,
    availableCopies: 55,
    chapters: [
      { name: "Real Numbers", description: "Fundamental theorem of arithmetic, irrationality proofs", topics: ["Euclid Division Lemma", "Fundamental Theorem of Arithmetic", "Revisiting Irrational Numbers"], term: "term1" },
      { name: "Polynomials", description: "Zeroes of polynomial, relationship between zeroes & coefficients", topics: ["Geometrical Meaning of Zeroes", "Relationship between Zeroes & Coefficients", "Division Algorithm"], term: "term1" },
      { name: "Pair of Linear Equations in Two Variables", description: "Graphical & algebraic methods of solution", topics: ["Graphical Method", "Substitution & Elimination", "Cross Multiplication"], term: "term1" },
      { name: "Quadratic Equations", description: "Standard form, factorization, quadratic formula", topics: ["Solving by Factorisation", "Completing the Square", "Nature of Roots"], term: "term1" },
      { name: "Arithmetic Progressions", description: "nth term of AP, sum of first n terms", topics: ["General Term of AP", "Sum of n Terms", "Application Problems"], term: "term2" },
      { name: "Trigonometry & Applications", description: "Trigonometric ratios, identities, heights and distances", topics: ["Trigonometric Ratios", "Trigonometric Identities", "Heights & Distances"], term: "term2" },
      { name: "Circles & Surface Areas", description: "Tangents to circle, surface area & volume of combinations & frustum", topics: ["Tangents to a Circle", "Surface Area of Combinations", "Volume of Frustum"], term: "term2" },
      { name: "Statistics & Probability", description: "Mean, median, mode of grouped data, theoretical probability", topics: ["Mean of Grouped Data", "Median & Mode", "Theoretical Probability"], term: "term2" },
    ],
  },
  {
    title: "Mathematics for Class 10 (R.D. Sharma)",
    author: "Dr. R.D. Sharma",
    isbn: "978-93-83182-38-0",
    category: "Mathematics",
    totalCopies: 30,
    availableCopies: 28,
    chapters: [
      { name: "Advanced Quadratic Equations & Polynomials", description: "Higher order problems and HOTS", topics: ["Nature of Roots HOTS", "Word Problems", "Polynomial Factorisation"], term: "term1" },
      { name: "Coordinate & Height Distance Practice", description: "Comprehensive problem sets and proofs", topics: ["Section Formula Applications", "Double Angle Trigonometry", "Complex Heights & Distances"], term: "term2" },
    ],
  },
  {
    title: "Advanced Mathematics Grade 12",
    author: "Dr. R.S. Aggarwal",
    isbn: "978-93-5283-050-3",
    category: "Mathematics",
    totalCopies: 40,
    availableCopies: 36,
    chapters: [
      { name: "Matrices & Determinants", description: "Types of matrices, inverse, system of linear equations", topics: ["Matrix Operations", "Determinant Properties", "Matrix Inverse Method"], term: "term1" },
      { name: "Continuity & Differentiability", description: "Derivatives of composite, implicit & inverse functions", topics: ["Continuity Tests", "Chain Rule", "Logarithmic Differentiation"], term: "term1" },
      { name: "Integrals & Differential Equations", description: "Indefinite & definite integrals, differential equation solutions", topics: ["Integration by Parts", "Definite Integral Properties", "Homogeneous Equations"], term: "term2" },
      { name: "Vector Algebra & 3D Geometry", description: "Vectors, scalar & vector products, lines & planes in 3D", topics: ["Dot & Cross Products", "Shortest Distance Between Lines", "Plane Equations"], term: "term2" },
    ],
  },

  // --- Science / Physics / Chemistry / Biology ---
  {
    title: "NCERT Science Grade 6",
    author: "NCERT",
    isbn: "978-81-7450-512-5",
    category: "Science",
    totalCopies: 45,
    availableCopies: 40,
    chapters: [
      { name: "Components of Food & Separation", description: "Nutrients, balanced diet, separation techniques", topics: ["Carbohydrates & Proteins", "Vitamins & Minerals", "Sieving & Winnowing"], term: "term1" },
      { name: "Sorting Materials & Changes", description: "Properties of materials, reversible & irreversible changes", topics: ["Solubility & Transparency", "Physical vs Chemical Changes", "Expansion & Contraction"], term: "term1" },
      { name: "Light, Shadows & Electricity", description: "Light sources, pinhole camera, electric circuit & switches", topics: ["Transparent & Opaque Objects", "Electric Circuits", "Conductors & Insulators"], term: "term2" },
      { name: "Fun with Magnets & Air", description: "Poles of magnet, magnetic compass, atmosphere composition", topics: ["Attraction & Repulsion", "Magnetic Compass", "Composition of Air"], term: "term2" },
    ],
  },
  {
    title: "NCERT Science Grade 10",
    author: "NCERT",
    isbn: "978-81-7450-643-6",
    category: "Science",
    totalCopies: 60,
    availableCopies: 52,
    chapters: [
      { name: "Chemical Reactions & Equations", description: "Balanced equations, types of reactions, corrosion & rancidity", topics: ["Balancing Equations", "Combination & Decomposition", "Oxidation & Reduction"], term: "term1" },
      { name: "Acids, Bases and Salts", description: "pH scale, indicator tests, preparation of salts", topics: ["pH Indicator Scale", "Reaction with Metals", "Plaster of Paris & Washing Soda"], term: "term1" },
      { name: "Life Processes", description: "Nutrition, respiration, transportation, excretion in plants & humans", topics: ["Autotrophic Nutrition", "Human Heart & Blood Circulation", "Nephron & Kidney Function"], term: "term1" },
      { name: "Light Reflection & Refraction", description: "Mirrors, lenses, ray diagrams, refractive index, lens formula", topics: ["Concave & Convex Mirrors", "Lens Formula & Power", "Refraction Through Glass Prism"], term: "term1" },
      { name: "Carbon & its Compounds", description: "Covalent bonding, homologous series, functional groups, soaps", topics: ["Covalent Bonding", "Functional Groups & Nomenclature", "Soaps and Detergents"], term: "term2" },
      { name: "Control & Coordination", description: "Nervous system, plant hormones, endocrine glands", topics: ["Reflex Arc", "Plant Tropisms", "Human Hormones"], term: "term2" },
      { name: "Electricity & Magnetic Effects", description: "Ohm's law, resistance, magnetic field lines, solenoid, electromagnetic induction", topics: ["Ohm's Law & Resistance", "Resistors in Series & Parallel", "Fleming Right & Left Hand Rules"], term: "term2" },
      { name: "Heredity & Evolution", description: "Mendel's experiments, sex determination, evolutionary traits", topics: ["Monohybrid & Dihybrid Cross", "Sex Determination in Humans", "Homologous Organs"], term: "term2" },
    ],
  },
  {
    title: "Concepts of Physics Part 1 & 2",
    author: "Dr. H.C. Verma",
    isbn: "978-81-7709-187-7",
    category: "Physics",
    totalCopies: 35,
    availableCopies: 31,
    chapters: [
      { name: "Laws of Motion & Work Energy", description: "Newton's laws, friction, work-energy theorem, power", topics: ["Newton Three Laws", "Friction Coefficients", "Work-Energy Theorem"], term: "term1" },
      { name: "Gravitation & Optics", description: "Universal gravitation, ray optics, reflection & refraction", topics: ["Gravitational Potential", "Lens Maker Formula", "Interference & Diffraction"], term: "term2" },
    ],
  },
  {
    title: "Comprehensive Chemistry Grade 11 & 12",
    author: "Dr. O.P. Tandon",
    isbn: "978-93-83182-12-0",
    category: "Chemistry",
    totalCopies: 35,
    availableCopies: 30,
    chapters: [
      { name: "Structure of Atom & Chemical Bonding", description: "Bohr model, quantum numbers, VSEPR theory, hybridization", topics: ["Quantum Numbers", "VSEPR Geometry", "Hybridisation & Molecular Orbitals"], term: "term1" },
      { name: "Organic Chemistry Fundamentals", description: "IUPAC nomenclature, isomerism, reaction mechanisms", topics: ["IUPAC Naming Rules", "Inductive & Resonance Effects", "Electrophilic Addition"], term: "term2" },
    ],
  },
  {
    title: "Biology for Class 11 & 12",
    author: "Trueman Publishing",
    isbn: "978-81-87224-40-1",
    category: "Biology",
    totalCopies: 30,
    availableCopies: 27,
    chapters: [
      { name: "Cell Structure & Function", description: "Cell organelles, cell cycle, mitosis and meiosis", topics: ["Prokaryotic vs Eukaryotic Cells", "Mitosis Stages", "Meiosis & Crossing Over"], term: "term1" },
      { name: "Genetics & Biotechnology", description: "Mendelian inheritance, DNA replication, recombinant DNA", topics: ["DNA Double Helix Structure", "Replication & Transcription", "PCR & Genetic Engineering"], term: "term2" },
    ],
  },

  // --- English ---
  {
    title: "First Flight - English Class 10",
    author: "NCERT",
    isbn: "978-81-7450-705-1",
    category: "English",
    totalCopies: 50,
    availableCopies: 45,
    chapters: [
      { name: "A Letter to God & Dust of Snow", description: "Faith of Lencho, prose & poetry analysis", topics: ["Character Sketch of Lencho", "Themes of Faith & Hope", "Poetic Devices in Dust of Snow"], term: "term1" },
      { name: "Nelson Mandela: Long Walk to Freedom", description: "Apartheid struggle and victory of freedom", topics: ["Freedom & Courage", "Swearing-in Ceremony Details", "Extraordinary Human Disaster"], term: "term1" },
      { name: "From the Diary of Anne Frank", description: "Excerpts from Anne Frank's wartime diary", topics: ["Life in Secret Annexe", "Relationship with Mr. Keesing", "Themes of Loneliness"], term: "term2" },
      { name: "Glimpses of India & The Proposal", description: "Bakers of Goa, Coorg, Tea from Assam, Chekhov's play", topics: ["Traditional Goan Bakers", "Coorg Wildlife & Culture", "Humor in The Proposal"], term: "term2" },
    ],
  },
  {
    title: "Footprints Without Feet - English Supplementary",
    author: "NCERT",
    isbn: "978-81-7450-706-8",
    category: "English",
    totalCopies: 50,
    availableCopies: 46,
    chapters: [
      { name: "A Triumph of Surgery & The Thief's Story", description: "Tricki's recovery, Anil & Hari Singh relationship", topics: ["Dr. Herriot's Strategy", "Trust & Reformation of Hari Singh"], term: "term1" },
      { name: "Footprints without Feet & The Necklace", description: "Griffin's invisibility, Matilda's discontent", topics: ["Misuse of Scientific Discovery", "Human Vanity & Consequences"], term: "term2" },
    ],
  },
  {
    title: "Flamingo - English Core Class 12",
    author: "NCERT",
    isbn: "978-81-7450-650-4",
    category: "English",
    totalCopies: 40,
    availableCopies: 37,
    chapters: [
      { name: "The Last Lesson & Lost Spring", description: "Language chauvinism, child labor in India", topics: ["Linguistic Chauvinism in Alsace", "Seemapuri Ragpickers & Firozabad Bangle Makers"], term: "term1" },
      { name: "Deep Water & The Rattrap", description: "Overcoming fear of water, metaphor of human traps", topics: ["Douglas Fear of Water", "Rattrap Metaphor & Peddler Reform"], term: "term2" },
    ],
  },

  // --- Social Studies / History / Geography / Civics / Economics ---
  {
    title: "India and the Contemporary World II (History Class 10)",
    author: "NCERT",
    isbn: "978-81-7450-707-5",
    category: "History",
    totalCopies: 45,
    availableCopies: 41,
    chapters: [
      { name: "The Rise of Nationalism in Europe", description: "French Revolution, Unification of Germany & Italy", topics: ["French Revolution & Idea of Nation", "Unification of Germany", "Unification of Italy"], term: "term1" },
      { name: "Nationalism in India", description: "Non-Cooperation, Civil Disobedience, Dandi March", topics: ["Rowlatt Act & Jallianwala Bagh", "Non-Cooperation Movement", "Salt March & Civil Disobedience"], term: "term1" },
      { name: "Print Culture and the Modern World", description: "First printed books, print revolution, reading mania", topics: ["Print in East Asia", "Print Revolution in Europe", "Print and Censorship in British India"], term: "term2" },
    ],
  },
  {
    title: "Contemporary India II (Geography Class 10)",
    author: "NCERT",
    isbn: "978-81-7450-709-9",
    category: "Geography",
    totalCopies: 45,
    availableCopies: 42,
    chapters: [
      { name: "Resources & Development", description: "Classification of resources, soil erosion & conservation", topics: ["Types of Resources", "Resource Planning in India", "Soil Types & Conservation"], term: "term1" },
      { name: "Water & Agriculture Resources", description: "Dams, rainwater harvesting, cropping patterns", topics: ["Multipurpose River Projects", "Rabi, Kharif & Zaid Crops", "Major Food Crops"], term: "term1" },
      { name: "Manufacturing Industries & Lifelines", description: "Agro & mineral based industries, transport networks", topics: ["Iron & Steel Industry", "Environmental Pollution", "Highways, Railways & Ports"], term: "term2" },
    ],
  },
  {
    title: "Democratic Politics II (Civics Class 10)",
    author: "NCERT",
    isbn: "978-81-7450-710-5",
    category: "Civics",
    totalCopies: 45,
    availableCopies: 40,
    chapters: [
      { name: "Power Sharing & Federalism", description: "Belgium & Sri Lanka models, Indian federal structure", topics: ["Forms of Power Sharing", "Federalism Features", "Decentralisation in India"], term: "term1" },
      { name: "Political Parties & Outcomes of Democracy", description: "Role of political parties, assessment of democratic outcomes", topics: ["National & Regional Parties", "Challenges to Parties", "Accountability & Responsiveness"], term: "term2" },
    ],
  },
  {
    title: "Understanding Economic Development (Economics Class 10)",
    author: "NCERT",
    isbn: "978-81-7450-711-2",
    category: "Economics",
    totalCopies: 45,
    availableCopies: 43,
    chapters: [
      { name: "Development & Sectors of Indian Economy", description: "PCI, HDI, Primary, Secondary & Tertiary sectors", topics: ["Income & Other Goals", "Organised vs Unorganised Sectors", "Public vs Private Sectors"], term: "term1" },
      { name: "Money, Credit & Globalisation", description: "Functions of money, formal/informal credit, MNCs", topics: ["Formal Sources of Credit", "Self Help Groups (SHGs)", "Impact of Globalisation"], term: "term2" },
    ],
  },

  // --- Computer Science & Information Technology ---
  {
    title: "Computer Science with Python Class 11 & 12",
    author: "Sumita Arora",
    isbn: "978-93-83182-45-8",
    category: "Computer Science",
    totalCopies: 40,
    availableCopies: 36,
    chapters: [
      { name: "Python Programming & Functions", description: "Variables, flow control, user defined functions & modules", topics: ["Data Types & Control Flow", "Function Parameters & Scope", "Built-in & Custom Modules"], term: "term1" },
      { name: "Data File Handling & SQL", description: "Text, CSV, binary file operations, relational databases", topics: ["File I/O in Python", "CSV & Pickle Modules", "SQL DDL & DML Commands"], term: "term2" },
    ],
  },
  {
    title: "Information Technology Code 402 Class 10",
    author: "Kips Publishing",
    isbn: "978-93-88844-12-6",
    category: "Information Technology",
    totalCopies: 40,
    availableCopies: 38,
    chapters: [
      { name: "Digital Documentation & Spreadsheets", description: "Styles, templates, mail merge, macros, sub-totals", topics: ["Creating Custom Styles", "Mail Merge Wizard", "Macros & Goal Seek"], term: "term1" },
      { name: "Database & Web Security", description: "RDBMS concepts, tables, forms, reports, web safety", topics: ["Relational Database Keys", "Form & Report Creation", "Internet Security Guidelines"], term: "term2" },
    ],
  },

  // --- Hindi & Sanskrit ---
  {
    title: "Sparsh Bhag 2 - Hindi Class 10",
    author: "NCERT",
    isbn: "978-81-7450-655-9",
    category: "Hindi",
    totalCopies: 50,
    availableCopies: 47,
    chapters: [
      { name: "कबीर साखी एवं मीरा पद", description: "भक्ति काल काव्य व्याख्या एवं प्रश्नोत्तर", topics: ["साखी भावार्थ", "मीरा पद व्याख्या", "काव्य सौंदर्य"], term: "term1" },
      { name: "नेताजी का चश्मा एवं बालगोबिन भगत", description: "गद्य पाठ एवं चरित्र चित्रण", topics: ["कैप्टन चश्मेवाले का चरित्र", "बालगोबिन भगत का व्यक्तित्व"], term: "term2" },
    ],
  },
  {
    title: "Shemushi Bhag 2 - Sanskrit Class 10",
    author: "NCERT",
    isbn: "978-81-7450-656-6",
    category: "Sanskrit",
    totalCopies: 35,
    availableCopies: 32,
    chapters: [
      { name: "शुचिपर्यावरणम् एवं बुद्धिरबलवती सदा", description: "श्लोक व्याख्या, सन्धि एवं व्याकरण", topics: ["श्लोकान्वयः", "स्वर-व्यंजन सन्धिः", "प्रत्ययाः"], term: "term1" },
    ],
  },

  // --- EVS & Physical Education & Art ---
  {
    title: "Environmental Studies (EVS) Grade 3 to 5",
    author: "NCERT",
    isbn: "978-81-7450-320-6",
    category: "EVS",
    totalCopies: 50,
    availableCopies: 48,
    chapters: [
      { name: "Looking Around & Going to School", description: "Transport methods, animal senses, nature conservation", topics: ["Bridges & Trolleys", "Super Senses of Animals", "Plant Kingdom"], term: "term1" },
      { name: "Water, Shelter & Food", description: "Water conservation, traditional houses, balanced food", topics: ["Rainwater Harvesting", "Types of Shelters", "Food Preservation"], term: "term2" },
    ],
  },
  {
    title: "Health and Physical Education Class 11 & 12",
    author: "Dr. V.K. Sharma",
    isbn: "978-93-5283-110-4",
    category: "Physical Education",
    totalCopies: 30,
    availableCopies: 28,
    chapters: [
      { name: "Olympic Movements & Yoga", description: "Ancient & modern Olympics, yogic asanas for wellness", topics: ["Olympic Symbol & Values", "Asanas for Back Pain & Obesity", "Pranayama Techniques"], term: "term1" },
      { name: "Sports Training & Kinesiology", description: "Principles of training, biomechanics in sports", topics: ["Levers & Equilibrium", "Flexibility & Endurance", "Sports Injuries & First Aid"], term: "term2" },
    ],
  },
  {
    title: "Visual Arts & Craft Education",
    author: "Anupam Books",
    isbn: "978-93-80011-02-7",
    category: "Art",
    totalCopies: 30,
    availableCopies: 29,
    chapters: [
      { name: "Elements of Art & Color Theory", description: "Lines, shapes, primary & secondary colors, shading", topics: ["Color Wheel", "Perspective Drawing", "Folk Art Patterns"], term: "term1" },
    ],
  },
];

const SUBJECT_DEFINITIONS = [
  { name: "Mathematics", code: "MATH", category: "Mathematics", description: "Core Mathematics curriculum covering arithmetic, algebra, geometry, trigonometry, and calculus." },
  { name: "Science", code: "SCI", category: "Science", description: "Integrated General Science for primary and middle school grades." },
  { name: "Physics", code: "PHY", category: "Physics", description: "Advanced Physics covering mechanics, thermodynamics, optics, and modern physics for senior secondary." },
  { name: "Chemistry", code: "CHEM", category: "Chemistry", description: "Physical, Organic, and Inorganic Chemistry for senior secondary grades." },
  { name: "Biology", code: "BIO", category: "Biology", description: "Botany, Zoology, Genetics, and Cell Biology for senior secondary grades." },
  { name: "English", code: "ENG", category: "English", description: "English Literature, Reading Comprehension, Grammar, and Creative Writing." },
  { name: "Social Studies", code: "SST", category: "History", description: "Integrated History, Geography, Civics, and Economics for secondary grades." },
  { name: "History", code: "HIST", category: "History", description: "Ancient, Medieval, Modern Indian, and World History." },
  { name: "Geography", code: "GEOG", category: "Geography", description: "Physical Geography, Human Geography, and Cartography." },
  { name: "Economics", code: "ECON", category: "Economics", description: "Microeconomics, Macroeconomics, and Indian Economic Development." },
  { name: "Political Science", code: "POL", category: "Civics", description: "Indian Constitution, Democratic Politics, and International Relations." },
  { name: "Hindi", code: "HIN", category: "Hindi", description: "Hindi Literature, Vyakaran, and Bhasha Abhyas." },
  { name: "Sanskrit", code: "SAN", category: "Sanskrit", description: "Sanskrit Sahitya, Shlokas, Vyakaran, and Translation." },
  { name: "Computer Science", code: "CS", category: "Computer Science", description: "Computer Fundamentals, Python Programming, SQL Databases, and Networking." },
  { name: "Information Technology", code: "IT", category: "Information Technology", description: "Digital Documentation, Electronic Spreadsheets, DBMS, and Web Applications." },
  { name: "Physical Education", code: "PE", category: "Physical Education", description: "Sports Science, Physical Fitness, Yoga, and Health Education." },
  { name: "Environmental Studies (EVS)", code: "EVS", category: "EVS", description: "Environmental Studies for primary grades." },
  { name: "Art & Craft", code: "ART", category: "Art", description: "Visual Arts, Sketching, Painting, and Craft Design." },
];

async function seedSubjectsAndBooks() {
  await connectDB();
  console.log("=======================================================");
  console.log("📚 SEEDING SUBJECTS, LIBRARY BOOKS & CURRICULUM...");
  console.log("=======================================================\n");

  // 1. Seed / Upsert Library Books
  console.log("1. Seeding Library Books...");
  const bookMap = new Map();

  for (const bData of BOOKS_DATA) {
    let book = await LibraryBook.findOne({ title: bData.title });
    if (!book) {
      book = await LibraryBook.create(bData);
      console.log(`   + Created Library Book: "${book.title}" (${book._id})`);
    } else {
      book.author = bData.author;
      book.isbn = bData.isbn;
      book.category = bData.category;
      book.chapters = bData.chapters;
      book.totalCopies = bData.totalCopies;
      book.availableCopies = bData.availableCopies;
      await book.save();
      console.log(`   ~ Updated Library Book: "${book.title}" (${book._id})`);
    }
    bookMap.set(bData.title, book);
  }

  // 2. Fetch All School Classes to assign subjects
  const allClasses = await SchoolClass.find({});
  console.log(`\n2. Found ${allClasses.length} school classes in database.`);

  const classMapByGrade = new Map();
  for (const cls of allClasses) {
    if (!classMapByGrade.has(cls.grade)) {
      classMapByGrade.set(cls.grade, []);
    }
    classMapByGrade.get(cls.grade).push(cls._id);
  }

  // 3. Seed / Upsert Subjects with Grade Curriculums
  console.log("\n3. Seeding Subjects & Grade Curriculum Mapping...");

  for (const sDef of SUBJECT_DEFINITIONS) {
    // Find matching classes for this subject based on standard grade logic
    let targetGrades = [];
    if (sDef.name === "Mathematics" || sDef.name === "English" || sDef.name === "Physical Education") {
      targetGrades = Array.from(classMapByGrade.keys());
    } else if (sDef.name === "Environmental Studies (EVS)") {
      targetGrades = ["Nursery", "LKG", "UKG", "1st", "2nd", "3rd", "4th", "5th"];
    } else if (sDef.name === "Science") {
      targetGrades = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
    } else if (sDef.name === "Physics" || sDef.name === "Chemistry" || sDef.name === "Biology") {
      targetGrades = ["11th", "12th"];
    } else if (sDef.name === "Social Studies") {
      targetGrades = ["6th", "7th", "8th", "9th", "10th"];
    } else if (sDef.name === "History" || sDef.name === "Geography" || sDef.name === "Political Science") {
      targetGrades = ["11th", "12th"];
    } else if (sDef.name === "Economics") {
      targetGrades = ["9th", "10th", "11th", "12th"];
    } else if (sDef.name === "Hindi") {
      targetGrades = ["Nursery", "LKG", "UKG", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
    } else if (sDef.name === "Sanskrit") {
      targetGrades = ["6th", "7th", "8th", "9th", "10th"];
    } else if (sDef.name === "Computer Science") {
      targetGrades = ["6th", "7th", "8th", "9th", "10th", "11th", "12th"];
    } else if (sDef.name === "Information Technology") {
      targetGrades = ["9th", "10th"];
    } else if (sDef.name === "Art & Craft") {
      targetGrades = ["Nursery", "LKG", "UKG", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
    }

    const assignedClassIds = [];
    for (const g of targetGrades) {
      if (classMapByGrade.has(g)) {
        assignedClassIds.push(...classMapByGrade.get(g));
      }
    }

    // Map curriculum per grade with appropriate library books
    const curriculum = [];
    for (const g of targetGrades) {
      if (!classMapByGrade.has(g)) continue;

      const matchingBooks = [];
      for (const [title, book] of bookMap.entries()) {
        if (book.category === sDef.category) {
          // Select books relevant to the grade
          if (
            (title.includes("Grade 6") && (g === "6th" || g === "5th")) ||
            (title.includes("Grade 9") && (g === "9th" || g === "8th")) ||
            (title.includes("Grade 10") || title.includes("Class 10")) && (g === "10th" || g === "9th") ||
            (title.includes("Grade 11") || title.includes("Class 11") || title.includes("Grade 12") || title.includes("Class 12")) && (g === "11th" || g === "12th") ||
            (!title.includes("Grade") && !title.includes("Class"))
          ) {
            matchingBooks.push({
              bookId: book._id,
              name: book.title,
              chapters: book.chapters.map((c) => ({
                name: c.name,
                description: c.description || "",
                topics: c.topics || [],
                term: c.term || "term1",
              })),
            });
          }
        }
      }

      curriculum.push({
        grade: g,
        books: matchingBooks,
      });
    }

    let subject = await Subject.findOne({ name: sDef.name });
    if (!subject) {
      subject = await Subject.create({
        name: sDef.name,
        code: sDef.code,
        description: sDef.description,
        classIds: assignedClassIds,
        curriculum,
        status: "active",
      });
      console.log(`   + Created Subject: "${subject.name}" (${subject.code}) -> Linked to ${assignedClassIds.length} classes across ${curriculum.length} grades.`);
    } else {
      subject.code = sDef.code;
      subject.description = sDef.description;
      subject.classIds = assignedClassIds;
      subject.curriculum = curriculum;
      subject.status = "active";
      await subject.save();
      console.log(`   ~ Updated Subject: "${subject.name}" (${subject.code}) -> Linked to ${assignedClassIds.length} classes across ${curriculum.length} grades.`);
    }
  }

  console.log("\n=======================================================");
  console.log("✅ SUBJECTS, BOOKS & CURRICULUM SEEDED SUCCESSFULLY!");
  console.log("=======================================================");

  await mongoose.disconnect();
}

seedSubjectsAndBooks().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
