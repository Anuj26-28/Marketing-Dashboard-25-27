---
name: isbm-placement-analytics
description: Master developer guide, architecture reference, and change history for M-Squad The Marketing Club Senior Batch (2025-27) Student Placement & Profile Analytics Visualization System. Use this skill whenever inspecting, modifying, extending, or maintaining the student dashboard, data schema, ranking algorithms, peer similarity benchmarks, radar visualizations, role matchmaker, or placement brochure charts.
---

# M-Squad The Marketing Club Placement & Student Analytics System: Developer Skill Guide

## 1. Project Overview & Context

This project is an interactive analytics, student profiling, and visualization system built for **M-Squad — The Marketing Club** for the **Senior Batch 2025–2027** (42 candidates, 100% Marketing Core with diverse dual specializations). Tagline: *Strategize | Create | Impact*.

The system serves four primary functions:
1. **Individual Candidate Profiler & Multi-Parameter Peer Benchmarker**:
   - Master-detail explorer allowing placement officers, club leadership, and recruiters to inspect individual candidate dossiers.
   - Computes live relative academic standing (higher/lower counts in Class 12th, 10th, and Graduation with percentiles).
   - **Multi-Parameter Peer Comparisons**:
     - *Corporate Work Experience*: Tenure percentiles, fresher vs experienced standing, peers with similar tenure brackets.
     - *Summer Internships*: Project intensity (single vs dual), duration rigor, and recruiter sector categorization.
     - *Verified Certifications & Competencies*: Upskilling volume percentiles, verified credential counts vs batch average, and live batch adoption rates for in-demand tools (Power BI, Excel, Gen AI, CRM, SEO, NISM, etc.).
   - **6-Axis Profile Competency Radar**: Renders an interactive hexagonal footprint (Academics, Corporate Exp, Internships, Analytics & Tools, Certifications, Soft Skills) contrasting the candidate against the **Batch Centroid Average**.
   - **Corporate Role Matchmaker**: Algorithmic suitability index across 5 MBA career pathways (B2B Sales & Key Accounts, Brand & Digital Marketing, Financial Analytics & Wealth Advisory, Business Intelligence & Market Research, Supply Chain & Operations).
   - Calculates a transparent, multi-dimensional **Overall Profile Rank (#1 to #42)** out of 100 points.

2. **Head-to-Head Candidate Comparator**:
   - Interactive comparator modal allowing side-by-side evaluation of any two students.
   - Dual-radar canvas overlay comparing multi-axis competency footprints.
   - Side-by-side metric comparison table with dynamic win highlights (`.compare-win`) across composite score, academics, corporate tenure, internships, and certifications.
   - Quick "View Full Dossier" navigation.

3. **Interactive Placement Brochure & Cohort Demographics Dashboard (12 Charts)**:
   - Executive MBA placement brochure visualizations:
     1. Work Experience Diversity (Donut)
     2. Undergraduate Discipline Background (Pie)
     3. Dual Specialization Distribution (Bar)
     4. Academic Standards 10th vs 12th vs Grad (Bar)
     5. Top Summer Recruiters (Horizontal Bar)
     6. Internship Functional Domains (Doughnut)
     7. Tool Stack & In-Demand Skills (Bar)
     8. Gender Balance Across Specializations (Stacked Bar)
     9. Recruiter Industry Sectors (Doughnut)
     10. Placement Readiness Talent Pyramid (Horizontal Bar)
     11. Academic Consistency & Trajectory (Grouped Bar)
     12. Multi-Skilling & Certification Volume Depth (Bar)
   - **Interactive Chart Drill-Down**: Clicking on *any* chart segment opens a modal listing all matching candidates with instant profile navigation and targeted Excel export.

4. **Data Portability & Live Refresh**:
   - Enriched export to Excel (`M-Squad_Senior_Batch_Placement_Analytics.xlsx`) via SheetJS.
   - Live drag-and-drop or file upload parser that reads `.xlsx` files directly in-browser and updates all state without reload.

---

## 2. Directory Structure & Key Files

```
C:\Users\Anuj . D\Documents\Antigravity IDE\
├── index.html                                        # Semantic HTML5 single-page application with M-Squad branding
├── styles.css                                        # Modern CSS3 design system (Dark/Light mode, Glassmorphism, Comparator & Radar styles)
├── app.js                                            # Reactive state, ranking engine, similarity algorithms, Radar charts, SheetJS
├── data.js                                           # Clean JSON pre-bundle of all 42 candidates
├── assets/
│   └── m_squad_logo.png                              # Official M-Squad shield logo
├── start_dashboard.ps1                               # PowerShell launcher script
├── data collection Senior Batchs 25-27 (Responses).xlsx  # Primary source Excel dataset
├── lib/
│   ├── chart.min.js                                 # Chart.js v4.4.1 (offline bundle)
│   └── xlsx.full.min.js                             # SheetJS v0.18.5 (offline bundle)
└── .agents/
    └── skills/
        └── isbm-placement-analytics/
            └── SKILL.md                              # This developer skill guide
```

---

## 3. Data Schema & Normalization (`data.js` & `app.js`)

Each student record conforms to the following normalized structure:

```typescript
interface Student {
  id: number;                     // 1-indexed unique identifier
  name: string;                   // Cleaned student full name
  email: string;                  // Primary email
  pgEmail: string;                // Postgrad institutional email
  mobile: string;                 // Cleaned 10-digit Indian mobile number
  rollNo: string;                 // Institute Roll Number (e.g., MNP20251121)
  gender: 'Male' | 'Female';      // Gender (50:50 parity: 21 M / 21 F)
  section: 'A' | 'B' | 'C' | 'D' | 'E'; // Section division
  aoi: string;                    // Area of Interest (Primary Specialization: Marketing)
  specialization: string;         // Other Specialization: Finance, Media, LSCM, Business Analytics, HR
  perc10: number;                 // Class 10th Percentage (55.0 to 99.2%)
  perc12: number;                 // Class 12th Percentage (55.17 to 95.0%)
  percGrad: number;               // Graduation Percentage (58.55 to 92.62%)
  gradStreamRaw: string;          // Original user response for undergrad degree
  gradStream: string;             // Standardized stream: Commerce (B.Com), Management (BBA), Engineering & Tech, Arts, Science
  gradUniversity: string;         // Undergrad University
  hasWorkExp: boolean;            // Whether candidate has prior corporate work experience
  workExpMonths: number;          // Work experience duration in months (0 for freshers)
  workExpRaw: string;             // Raw string from form (e.g., "2 years", "17 months")
  prevJobRole: string;            // Prior job title and organization
  internship1Company: string;     // Standardized recruiter name (e.g., "Burger King", "Godrej Properties")
  internship1Role: string;        // Functional role (e.g., "Retail Sales Intern", "SEO-Digital Marketing")
  internship1Duration: string;    // Duration (e.g., "2 months", "3 months")
  internship2Company: string;     // Secondary internship company (if any)
  internship2Role: string;        // Secondary internship role (if any)
  internship2Duration: string;    // Secondary internship duration
  numInternships: number;         // 1 or 2
  certifications: string;         // Raw and parsed certifications text
  softSkills: string;             // Raw and parsed soft skills & tools
  cvLink: string;                 // Google Drive link to verified resume/CV
  scores: CompositeScore;         // Computed scoring breakdown (Academics, Exp, Internships, Skills)
  rank: number;                   // Batch rank (#1 to #42)
  percentile: number;             // Batch percentile
}
```

---

## 4. Overall Profile Ranking Engine

The ranking algorithm uses a balanced 100-point composite model reflecting corporate placement evaluation criteria:

```
Total Score (100 pts) = Academics (35) + Work Experience (25) + Internships (25) + Skills/Certs (15)
```

1. **Academics Consistency (Max 35 pts)**:
   - 10th Score: $\min(10, \max(0, \frac{\text{perc10} - 50}{50} \times 10))$
   - 12th Score: $\min(12.5, \max(0, \frac{\text{perc12} - 50}{50} \times 12.5))$
   - Graduation Score: $\min(12.5, \max(0, \frac{\text{percGrad} - 50}{50} \times 12.5))$
2. **Prior Corporate Work Experience (Max 25 pts)**:
   - Freshers: 6 pts baseline (academic focus & adaptability)
   - 1–6 months: 14 pts
   - 7–12 months: 18 pts
   - 13–23 months: 22 pts
   - 24+ months: 25 pts (maximum score, sweet spot for lateral MBA roles)
3. **Summer Internships Depth & Brand Scope (Max 25 pts)**:
   - 1st internship: 12 pts baseline
   - 2nd verified internship: +6 pts
   - Duration $\ge$ 3 months: +4 pts
   - Recognized corporate brand / strategic role: +3 pts
4. **Skills & Certifications Depth (Max 15 pts)**:
   - Verified certifications (NISM, Udemy, Forage, Infosys, Google): up to 8 pts
   - Tool stack proficiency (MS Excel, Power BI, Generative AI, CRM, Python, SEO, Canva): up to 7 pts
5. **Tie-Breaking Order**:
   - Total Composite Score $\rightarrow$ Graduation % $\rightarrow$ Class 12th %.

---

## 5. Peer Benchmarks & Multi-Dimensional Analytics (`getPeerBenchmarks`)

For any active candidate:
- **Relative Academic Standings**: Computes percentiles and higher/lower cohort counts across 10th, 12th, and Graduation.
- **Corporate Experience Standing**: Relative tenure percentiles and count of peers with similar tenure brackets ($\pm 6$ months).
- **Internship Rigor**: Benchmarks single vs dual internship scope against cohort and categorizes employer into macro-sectors:
  - *BFSI & Wealth Advisory*
  - *FMCG & QSR*
  - *Real Estate & Infrastructure*
  - *IT, Tech & Manufacturing*
  - *Media, Analytics & Agency*
  - *Corporate Strategy & Services*
- **Certification Volume & In-Demand Tools**: Evaluates certificate depth percentile and displays live batch adoption rate chips for candidate tools (e.g., "Power BI • 17 peers (40% of batch)").
- **6-Axis Radar Competency Vector**:
  - Normalized 0–100 scores across: *Academics, Corporate Exp, Internships, Analytics & Tools, Certifications, Soft Skills*.
  - Compares against the static/dynamic **Batch Centroid Average** `[74, 38, 65, 58, 55, 75]`.
- **Role Matchmaker**: Evaluates percentage alignment for 5 key corporate pathways with customized placement rationales.

---

## 6. Interactive Placement Brochure Architecture (12 Charts)

All 12 charts in Tab 2 feature click drilldowns via `onClick(event, elements)`:
- Resolves the clicked category label.
- Filters `rankedStudents` matching the predicate.
- Opens `#modal-chart-drilldown` displaying candidate cards with search filtering.
- Clicking any candidate switches to Tab 1 (`#tab-individual`), selects that student, and scrolls smoothly to their dossier.
- Supports dedicated custom cohort Excel export (`M-Squad_<Category>_Cohort.xlsx`).

---

## 7. Change Log & Evolution

### Version 1.2.0 (Current)
- Rebranded institute styling and titles to **M-Squad The Marketing Club** with official shield logo (`assets/m_squad_logo.png`) and tagline (*Strategize | Create | Impact*).
- Added **Multi-Parameter Peer Comparisons**: Corporate Work Experience tenure standing, Summer Internship depth & recruiter sector, and Verified Certifications volume & tool adoption rates.
- Introduced **6-Axis Profile Competency Radar Chart** in Individual Profiles contrasting candidate footprint against Batch Centroid Average.
- Added **Corporate Career Alignment & Role Matchmaker** with 5 career pathway suitability indices.
- Built **Head-to-Head Candidate Comparator** modal with dual-candidate selection, dual-radar canvas overlay, and green delta win indicators.
- Expanded Placement Brochure to **12 Charts** adding Gender Balance across Specializations, Recruiter Sectors, Talent Pyramid, Academic Trajectory, and Multi-Skilling Depth.

### Version 1.1.0
- Added dedicated **AOI (Area of Interest)** and **Other Specialization** segmented buttons and filters.
- Implemented **Interactive Chart Drill-Down**: Clicking any data point or bar in any Placement Brochure chart reveals the list of matching candidates with profile jump links and segment Excel export.
- Added comprehensive developer skill file.

### Version 1.0.0 (Initial Release)
- Two-tab layout: Individual Profiles and Placement Brochure Dashboard.
- Master-detail layout with peer similarity benchmarks and 100-point ranking formula.
- Chart.js dashboards for MBA placement demographics.
- SheetJS live Excel import and enriched export.
- Dark and light mode toggle.
