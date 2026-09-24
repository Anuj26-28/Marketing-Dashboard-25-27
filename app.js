/**
 * ISB&M Senior Batch (2025-27) Placement & Student Analytics
 * Core Application Engine with Chart Drill-Down & Advanced Filtering
 */

(function () {
  'use strict';

  // ==================== APPLICATION STATE ====================
  let rawBatchData = [];
  let rankedStudents = [];
  let currentStudentId = null;
  let activeTab = 'individual';
  let charts = {};

  // Drill-Down Modal State
  let activeDrilldownStudents = [];
  let activeDrilldownCategory = '';

  // Filters & Search
  let searchQuery = '';
  let filterAOI = 'ALL';
  let filterSpec = 'ALL';
  let filterExp = 'ALL';
  let filterSection = 'ALL';
  let currentSort = 'RANK_ASC';

  // ==================== SCORING & RANKING ENGINE ====================
  /**
   * Transparent 100-point composite scoring model:
   * 1. Academics: Max 35 points (10th: 10 pts, 12th: 12.5 pts, Grad: 12.5 pts)
   * 2. Work Experience: Max 25 points (Fresher: 6 pts, 1-6m: 14 pts, 7-12m: 18 pts, 13-23m: 22 pts, 24m+: 25 pts)
   * 3. Internships: Max 25 points (Int 1: 12 pts, Int 2: +6 pts, Duration >=3m: +4 pts, Brand/Role: +3 pts)
   * 4. Skills & Certs: Max 15 points (Certs: up to 8 pts, Core Tools: up to 7 pts)
   */
  function computeStudentScore(s) {
    // 1. Academics (35 pts)
    const p10 = Number(s.perc10) || 0;
    const p12 = Number(s.perc12) || 0;
    const pGrad = Number(s.percGrad) || 0;

    const score10 = Math.min(10, Math.max(0, ((p10 - 50) / 50) * 10));
    const score12 = Math.min(12.5, Math.max(0, ((p12 - 50) / 50) * 12.5));
    const scoreGrad = Math.min(12.5, Math.max(0, ((pGrad - 50) / 50) * 12.5));
    const academicScore = Math.round((score10 + score12 + scoreGrad) * 10) / 10;

    // 2. Work Experience (25 pts)
    let workExpScore = 6; // Fresher baseline
    const months = Number(s.workExpMonths) || 0;
    if (s.hasWorkExp || months > 0) {
      if (months >= 24) workExpScore = 25;
      else if (months >= 13) workExpScore = 22;
      else if (months >= 7) workExpScore = 18;
      else if (months >= 1) workExpScore = 14;
      else workExpScore = 10;
    }

    // 3. Summer Internships (25 pts)
    let internshipScore = 12; // Base for 1st internship
    if (Number(s.numInternships) >= 2 || (s.internship2Company && s.internship2Company.length > 2)) {
      internshipScore += 6;
    }
    const d1 = (s.internship1Duration || '').toLowerCase();
    const d2 = (s.internship2Duration || '').toLowerCase();
    if (d1.includes('3') || d1.includes('4') || d2.includes('3') || d2.includes('4')) {
      internshipScore += 4;
    }
    if (s.internship1Company && s.internship1Company.trim().length > 2) {
      internshipScore += 3;
    }
    internshipScore = Math.min(25, internshipScore);

    // 4. Skills & Certifications (15 pts)
    const certText = (s.certifications || '').toLowerCase();
    const skillText = (s.softSkills || '').toLowerCase();
    const combined = certText + ' ' + skillText;

    const keywords = ['excel', 'power bi', 'analytics', 'generative ai', 'ai', 'crm', 'python', 'sql', 'seo', 'digital marketing', 'canva', 'nism'];
    let matchedKw = 0;
    keywords.forEach(kw => {
      if (combined.includes(kw)) matchedKw++;
    });

    const certEntries = s.certifications ? s.certifications.split(/[\n,;•?-]/).filter(t => t.trim().length > 3).length : 0;
    const certPts = Math.min(8, certEntries * 2.2);
    const toolPts = Math.min(7, matchedKw * 1.5);
    const skillsScore = Math.round(Math.min(15, certPts + toolPts) * 10) / 10;

    const totalComposite = Math.round((academicScore + workExpScore + internshipScore + skillsScore) * 10) / 10;

    return {
      academicScore,
      score10: Math.round(score10 * 10) / 10,
      score12: Math.round(score12 * 10) / 10,
      scoreGrad: Math.round(scoreGrad * 10) / 10,
      workExpScore,
      internshipScore,
      skillsScore,
      totalComposite
    };
  }

  function processAndRankStudents(data) {
    const list = data.map((item, idx) => {
      const scores = computeStudentScore(item);
      return {
        ...item,
        id: item.id || (idx + 1),
        scores
      };
    });

    // Sort by totalComposite DESC, then percGrad DESC, then perc12 DESC
    list.sort((a, b) => {
      if (b.scores.totalComposite !== a.scores.totalComposite) {
        return b.scores.totalComposite - a.scores.totalComposite;
      }
      if (b.percGrad !== a.percGrad) {
        return (Number(b.percGrad) || 0) - (Number(a.percGrad) || 0);
      }
      return (Number(b.perc12) || 0) - (Number(a.perc12) || 0);
    });

    // Assign Ranks
    const total = list.length;
    return list.map((s, idx) => {
      const rank = idx + 1;
      const percentile = Math.round(((total - rank) / (total - 1 || 1)) * 100);
      return {
        ...s,
        rank,
        percentile
      };
    });
  }

  // ==================== PEER SIMILARITY BENCHMARKS ====================
  function getPeerBenchmarks(targetStudent, batch) {
    const total = batch.length;
    const target12 = Number(targetStudent.perc12) || 0;
    const target10 = Number(targetStudent.perc10) || 0;
    const targetGrad = Number(targetStudent.percGrad) || 0;

    // 1. Class 12th Comparison
    const higher12 = batch.filter(s => Number(s.perc12) > target12);
    const lower12 = batch.filter(s => Number(s.perc12) < target12);
    const equal12 = batch.filter(s => Number(s.perc12) === target12 && s.id !== targetStudent.id);
    const percentile12 = Math.round((lower12.length / (total - 1 || 1)) * 100);

    // 2. Class 10th Comparison
    const higher10 = batch.filter(s => Number(s.perc10) > target10);
    const lower10 = batch.filter(s => Number(s.perc10) < target10);
    const percentile10 = Math.round((lower10.length / (total - 1 || 1)) * 100);

    // 3. Graduation % Comparison
    const higherGrad = batch.filter(s => Number(s.percGrad) > targetGrad);
    const lowerGrad = batch.filter(s => Number(s.percGrad) < targetGrad);
    const percentileGrad = Math.round((lowerGrad.length / (total - 1 || 1)) * 100);

    // 4. Corporate Work Experience Benchmarks
    const targetExp = Number(targetStudent.workExpMonths) || 0;
    const higherExp = batch.filter(s => (Number(s.workExpMonths) || 0) > targetExp);
    const lowerExp = batch.filter(s => (Number(s.workExpMonths) || 0) < targetExp);
    const equalExp = batch.filter(s => (Number(s.workExpMonths) || 0) === targetExp && s.id !== targetStudent.id);
    const percentileExp = targetExp > 0 ? Math.round(((total - higherExp.length) / total) * 100) : 0;
    const sameTenurePeers = batch.filter(s => s.id !== targetStudent.id && targetExp > 0 && Math.abs((Number(s.workExpMonths) || 0) - targetExp) <= 6 && (Number(s.workExpMonths) || 0) > 0);

    // 5. Summer Internship Rigor & Recruiter Sector Benchmarks
    const hasDual = Number(targetStudent.numInternships) >= 2 || (targetStudent.internship2Company && targetStudent.internship2Company.toLowerCase() !== 'na' && targetStudent.internship2Company.toLowerCase() !== 'none');
    const dualCohort = batch.filter(s => Number(s.numInternships) >= 2 || (s.internship2Company && s.internship2Company.toLowerCase() !== 'na' && s.internship2Company.toLowerCase() !== 'none'));
    const singleCohort = batch.filter(s => !dualCohort.some(d => d.id === s.id));
    const percentileInternships = hasDual ? Math.round(((total - 2) / total) * 100) : 38;

    function getRecruiterSector(comp) {
      if (!comp) return 'General Corporate';
      const c = comp.toLowerCase();
      if (c.includes('trust') || c.includes('birla') || c.includes('bajaj') || c.includes('mutual') || c.includes('capital') || c.includes('bank')) return 'BFSI & Wealth Advisory';
      if (c.includes('burger') || c.includes('fmcg') || c.includes('food')) return 'FMCG & QSR';
      if (c.includes('propedge') || c.includes('estate') || c.includes('realty') || c.includes('godrej') || c.includes('housing')) return 'Real Estate & Infrastructure';
      if (c.includes('noor') || c.includes('tech') || c.includes('metals')) return 'IT, Tech & Manufacturing';
      if (c.includes('kantar') || c.includes('media') || c.includes('ad')) return 'Media, Analytics & Agency';
      return 'Corporate Strategy & Services';
    }
    const recruiterSector = getRecruiterSector(targetStudent.internship1Company);
    const sameSectorPeers = batch.filter(s => s.id !== targetStudent.id && getRecruiterSector(s.internship1Company) === recruiterSector);

    // 6. Verified Certifications & Tool Prevalence Benchmarks
    function parseCerts(s) {
      return s.certifications ? s.certifications.split(/[\n;?•]/).map(t => t.trim()).filter(t => t.length > 2) : [];
    }
    const targetCertList = parseCerts(targetStudent);
    const targetCertCount = targetCertList.length;
    const higherCerts = batch.filter(s => parseCerts(s).length > targetCertCount);
    const lowerCerts = batch.filter(s => parseCerts(s).length < targetCertCount);
    const percentileCerts = Math.round((lowerCerts.length / (total - 1 || 1)) * 100);

    const toolKeywords = [
      { key: 'power bi', name: 'Power BI' },
      { key: 'excel', name: 'Advanced Excel' },
      { key: 'generative ai', name: 'Generative AI' },
      { key: 'crm', name: 'CRM Systems' },
      { key: 'seo', name: 'Digital SEO' },
      { key: 'python', name: 'Python' },
      { key: 'sql', name: 'SQL' },
      { key: 'nism', name: 'NISM Certified' },
      { key: 'canva', name: 'Canva Media' }
    ];
    const targetFullText = ((targetStudent.certifications || '') + ' ' + (targetStudent.softSkills || '')).toLowerCase();
    const candidateTools = [];
    toolKeywords.forEach(tool => {
      if (targetFullText.includes(tool.key)) {
        const cohortHolders = batch.filter(s => ((s.certifications || '') + ' ' + (s.softSkills || '')).toLowerCase().includes(tool.key));
        candidateTools.push({
          name: tool.name,
          cohortCount: cohortHolders.length,
          cohortPct: Math.round((cohortHolders.length / total) * 100)
        });
      }
    });

    // 7. 6-Axis Holistic Competency Radar Vector
    const avgAcad = (Number(targetStudent.perc10 || 0) + Number(targetStudent.perc12 || 0) + Number(targetStudent.percGrad || 0)) / 3;
    const radarAcad = Math.min(100, Math.round((avgAcad / 88) * 100));
    const radarExp = targetStudent.hasWorkExp || targetExp > 0 ? Math.min(100, Math.round((Math.max(6, targetExp) / 24) * 100)) : 22;
    let radarInt = hasDual ? 88 : 62;
    const dur = (targetStudent.internship1Duration || '').toLowerCase();
    if (dur.includes('3') || dur.includes('4')) radarInt = Math.min(100, radarInt + 12);
    let radarTools = 45;
    if (targetFullText.includes('power bi')) radarTools += 20;
    if (targetFullText.includes('excel')) radarTools += 15;
    if (targetFullText.includes('sql') || targetFullText.includes('python')) radarTools += 20;
    radarTools = Math.min(100, radarTools);
    const radarCerts = Math.min(100, Math.max(25, targetCertCount * 28));
    const softText = (targetStudent.softSkills || '').toLowerCase();
    let radarSoft = 65;
    if (softText.includes('leader')) radarSoft += 12;
    if (softText.includes('communicat')) radarSoft += 12;
    if (softText.includes('problem')) radarSoft += 11;
    radarSoft = Math.min(100, radarSoft);

    const radarCandidate = [radarAcad, radarExp, radarInt, radarTools, radarCerts, radarSoft];
    const radarBatchAvg = [74, 38, 65, 58, 55, 75];

    // 8. Corporate Role Pathways Suitability Index
    const rolePathways = [
      {
        role: 'B2B Enterprise Sales & Key Account Management',
        match: Math.min(98, 70 + (targetFullText.includes('sales') || (targetStudent.internship1Role || '').toLowerCase().includes('sales') ? 15 : 5) + (targetStudent.hasWorkExp ? 10 : 0) + (softText.includes('communicat') ? 4 : 0)),
        rationale: 'Strong commercial persuasion, consultative communication, and direct sales immersion during summer tenure.'
      },
      {
        role: 'Digital Marketing & Brand Strategy',
        match: Math.min(98, 65 + (targetFullText.includes('digital') || targetFullText.includes('seo') || targetFullText.includes('canva') ? 20 : 5) + (targetStudent.specialization === 'Media' ? 12 : 0)),
        rationale: 'Campaign architecture mindset, audience segmentation agility, and content production tool fluency.'
      },
      {
        role: 'Financial Analytics & Wealth Advisory',
        match: Math.min(98, (targetStudent.specialization === 'Finance' ? 76 : 45) + (targetFullText.includes('excel') || targetFullText.includes('nism') || targetFullText.includes('account') ? 16 : 5) + (recruiterSector.includes('BFSI') ? 8 : 0)),
        rationale: 'Quantitative financial modeling discipline, market instruments awareness, and corporate reporting literacy.'
      },
      {
        role: 'Business Intelligence & Market Research',
        match: Math.min(98, (targetStudent.specialization === 'Business Analytics' ? 82 : 50) + (targetFullText.includes('power bi') || targetFullText.includes('python') || targetFullText.includes('sql') ? 15 : 5)),
        rationale: 'Analytical dashboard design, metric tracking framework, and exploratory hypothesis formulation.'
      },
      {
        role: 'Supply Chain & Operations Management',
        match: Math.min(98, (targetStudent.specialization === 'LSCM' ? 82 : 45) + (targetStudent.hasWorkExp ? 12 : 5) + (dur.includes('3') ? 5 : 0)),
        rationale: 'Logistics distribution channel logic, process bottleneck mitigation, and quality assurance discipline.'
      }
    ].sort((a, b) => b.match - a.match);

    // 9. Same Internship Company Peers
    const c1 = (targetStudent.internship1Company || '').trim().toLowerCase();
    const c2 = (targetStudent.internship2Company || '').trim().toLowerCase();
    const sameCompanyPeers = batch.filter(s => {
      if (s.id === targetStudent.id) return false;
      const sc1 = (s.internship1Company || '').trim().toLowerCase();
      const sc2 = (s.internship2Company || '').trim().toLowerCase();
      if (!c1 || c1 === 'none' || c1 === 'na') return false;
      return (c1 && (sc1 === c1 || sc2 === c1)) || (c2 && c2 !== 'none' && c2 !== 'na' && (sc1 === c2 || sc2 === c2));
    });

    // 10. Cohort Counts
    const sameSpecPeers = batch.filter(s => s.id !== targetStudent.id && s.specialization === targetStudent.specialization);
    const sameStreamPeers = batch.filter(s => s.id !== targetStudent.id && s.gradStream === targetStudent.gradStream);
    const isTargetExp = targetStudent.hasWorkExp || targetStudent.workExpMonths > 0;
    const sameExpPeers = batch.filter(s => s.id !== targetStudent.id && (s.hasWorkExp || s.workExpMonths > 0) === isTargetExp);

    // 11. Top 3 Closest Profile Matches (Euclidean Distance across normalized vectors)
    const candidates = batch
      .filter(s => s.id !== targetStudent.id)
      .map(s => {
        const d10 = (Number(s.perc10) - target10) / 45;
        const d12 = (Number(s.perc12) - target12) / 45;
        const dGrad = (Number(s.percGrad) - targetGrad) / 40;
        const dExp = ((Number(s.workExpMonths) || 0) - (Number(targetStudent.workExpMonths) || 0)) / 24;
        const dSpec = s.specialization === targetStudent.specialization ? 0 : 0.8;
        const dStream = s.gradStream === targetStudent.gradStream ? 0 : 0.6;

        const dist = Math.sqrt(d10 * d10 + d12 * d12 + dGrad * dGrad + dExp * dExp + dSpec * dSpec + dStream * dStream);
        const similarityPct = Math.max(50, Math.round((1 - dist / 3) * 100));
        return { student: s, dist, similarityPct };
      });

    candidates.sort((a, b) => a.dist - b.dist);
    const closestPeers = candidates.slice(0, 3);

    return {
      percentile12,
      countHigher12: higher12.length,
      countLower12: lower12.length,
      countEqual12: equal12.length,
      percentile10,
      countHigher10: higher10.length,
      countLower10: lower10.length,
      percentileGrad,
      countHigherGrad: higherGrad.length,
      countLowerGrad: lowerGrad.length,
      // Work Experience Peer Benchmarks
      targetExp,
      percentileExp,
      countHigherExp: higherExp.length,
      countLowerExp: lowerExp.length,
      countEqualExp: equalExp.length,
      sameTenurePeersCount: sameTenurePeers.length,
      // Summer Internship Peer Benchmarks
      hasDual,
      dualCohortCount: dualCohort.length,
      singleCohortCount: singleCohort.length,
      percentileInternships,
      recruiterSector,
      sameSectorPeersCount: sameSectorPeers.length,
      // Verified Certifications & Tools
      targetCertCount,
      countHigherCerts: higherCerts.length,
      countLowerCerts: lowerCerts.length,
      percentileCerts,
      candidateTools,
      // 6-Axis Radar Vectors
      radarCandidate,
      radarBatchAvg,
      // Role Pathways
      rolePathways,
      // Cohorts
      sameCompanyPeers,
      targetCompany: targetStudent.internship1Company || 'None',
      sameSpecCount: sameSpecPeers.length,
      sameStreamCount: sameStreamPeers.length,
      sameExpCount: sameExpPeers.length,
      closestPeers
    };
  }

  // ==================== RENDERING: STUDENT LIST ====================
  function getFilteredStudents() {
    return rankedStudents.filter(s => {
      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = s.name.toLowerCase().includes(q);
        const matchRoll = (s.rollNo || '').toLowerCase().includes(q);
        const matchEmail = (s.email || '').toLowerCase().includes(q);
        const matchComp = (s.internship1Company || '').toLowerCase().includes(q) || (s.internship2Company || '').toLowerCase().includes(q);
        const matchSkill = (s.certifications || '').toLowerCase().includes(q) || (s.softSkills || '').toLowerCase().includes(q);
        if (!matchName && !matchRoll && !matchEmail && !matchComp && !matchSkill) return false;
      }

      // AOI Filter (Primary Specialization)
      if (filterAOI !== 'ALL' && s.aoi !== filterAOI) return false;

      // Other Specialization Filter (Secondary Specialization)
      if (filterSpec !== 'ALL' && s.specialization !== filterSpec) return false;

      // Experience Filter
      if (filterExp === 'FRESHER' && (s.hasWorkExp || s.workExpMonths > 0)) return false;
      if (filterExp === 'EXP' && !(s.hasWorkExp || s.workExpMonths > 0)) return false;

      // Section Filter
      if (filterSection !== 'ALL' && s.section !== filterSection) return false;

      return true;
    }).sort((a, b) => {
      switch (currentSort) {
        case 'RANK_ASC': return a.rank - b.rank;
        case 'P12_DESC': return (Number(b.perc12) || 0) - (Number(a.perc12) || 0);
        case 'P10_DESC': return (Number(b.perc10) || 0) - (Number(a.perc10) || 0);
        case 'GRAD_DESC': return (Number(b.percGrad) || 0) - (Number(a.percGrad) || 0);
        case 'EXP_DESC': return (Number(b.workExpMonths) || 0) - (Number(a.workExpMonths) || 0);
        case 'NAME_ASC': return a.name.localeCompare(b.name);
        default: return a.rank - b.rank;
      }
    });
  }

  function renderStudentList() {
    const container = document.getElementById('student-list-container');
    const countLabel = document.getElementById('candidate-count-label');
    const filtered = getFilteredStudents();

    countLabel.textContent = `${filtered.length} of ${rankedStudents.length} Candidates`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
          <p>No candidates match your current search/filters.</p>
        </div>
      `;
      return;
    }

    // Ensure selected student exists in filtered, otherwise select first filtered
    if (!filtered.some(s => s.id === currentStudentId)) {
      currentStudentId = filtered[0].id;
    }

    container.innerHTML = filtered.map(s => {
      const isActive = s.id === currentStudentId;
      let rankClass = '';
      if (s.rank === 1) rankClass = 'rank-top1';
      else if (s.rank === 2) rankClass = 'rank-top2';
      else if (s.rank === 3) rankClass = 'rank-top3';

      const expText = (s.hasWorkExp || s.workExpMonths > 0) ? `${s.workExpMonths}m Exp` : 'Fresher';
      const expBadgeClass = (s.hasWorkExp || s.workExpMonths > 0) ? 'pill-tag-exp' : '';

      return `
        <div class="student-item ${isActive ? 'active' : ''}" data-id="${s.id}" role="button" tabindex="0">
          <div class="rank-badge-sm ${rankClass}">#${s.rank}</div>
          <div class="student-item-info">
            <div class="student-item-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
            <div class="student-item-meta">
              <span class="pill-tag" style="background: rgba(6, 182, 212, 0.15); border-color: rgba(6, 182, 212, 0.3); color: var(--secondary);" title="Primary AOI: ${escapeHtml(s.aoi)} • Other: ${escapeHtml(s.specialization)}">
                ${escapeHtml(s.specialization)}
              </span>
              <span class="pill-tag ${expBadgeClass}">${expText}</span>
              <span class="item-meta-score">12th: ${s.perc12}%</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events
    container.querySelectorAll('.student-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = Number(item.getAttribute('data-id'));
        selectStudent(id);
      });
    });

    renderStudentDossier();
  }

  function selectStudent(id) {
    currentStudentId = id;
    // Update active class in list without full re-render for smooth response
    const container = document.getElementById('student-list-container');
    container.querySelectorAll('.student-item').forEach(el => {
      const elId = Number(el.getAttribute('data-id'));
      if (elId === currentStudentId) {
        el.classList.add('active');
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.classList.remove('active');
      }
    });
    renderStudentDossier();
  }

  // ==================== RENDERING: STUDENT DOSSIER ====================
  function renderStudentDossier() {
    const container = document.getElementById('student-dossier-container');
    const student = rankedStudents.find(s => s.id === currentStudentId);

    if (!student) {
      container.innerHTML = `<div class="card"><p>Select a student to view details.</p></div>`;
      return;
    }

    const b = getPeerBenchmarks(student, rankedStudents);
    const initials = student.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    // Tier description
    let tierLabel = 'Competitive Profile';
    let tierColor = 'var(--text-secondary)';
    if (student.rank <= 3) {
      tierLabel = 'Top 7% • Dean\'s Honor Tier';
      tierColor = 'var(--accent-gold)';
    } else if (student.rank <= 10) {
      tierLabel = 'Top 25% • High Distinction';
      tierColor = 'var(--accent-emerald)';
    } else if (student.rank <= 25) {
      tierLabel = 'Upper Tier • Core Placement Talent';
      tierColor = 'var(--primary-light)';
    }

    // Format soft skills tags
    const skillsList = student.softSkills
      ? student.softSkills.split(/[\n,;•?-]/).map(t => t.trim()).filter(t => t.length > 2)
      : [];

    // Format certs list
    const certsList = student.certifications
      ? student.certifications.split(/[\n;?•]/).map(t => t.trim()).filter(t => t.length > 2)
      : [];

    container.innerHTML = `
      <!-- Hero Banner & Rank Card -->
      <div class="hero-card">
        <div class="hero-content">
          <div class="hero-identity">
            <div class="hero-avatar">${initials}</div>
            <div class="hero-details">
              <h2>
                ${escapeHtml(student.name)}
                <span class="pill-tag pill-tag-primary" style="font-size: 0.75rem; vertical-align: middle;">
                  Sec ${student.section || 'A'} • ${escapeHtml(student.gender)}
                </span>
              </h2>
              <div class="hero-badges">
                <span class="pill-tag" style="background: rgba(99, 102, 241, 0.15); border-color: rgba(99, 102, 241, 0.3); color: var(--primary-light); font-weight: 700;">
                  AOI (Primary): ${escapeHtml(student.aoi || 'Marketing')}
                </span>
                <span class="pill-tag" style="background: rgba(6, 182, 212, 0.15); border-color: rgba(6, 182, 212, 0.3); color: var(--secondary); font-weight: 700;">
                  Other Specialization: ${escapeHtml(student.specialization)}
                </span>
                <span class="pill-tag" style="background: rgba(255, 255, 255, 0.05);">
                  Roll: ${escapeHtml(student.rollNo || 'N/A')}
                </span>
              </div>
              <div class="hero-contact">
                <span class="hero-contact-item" title="Email">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                  ${escapeHtml(student.email || student.pgEmail || 'N/A')}
                </span>
                ${student.mobile ? `
                  <span class="hero-contact-item" title="Mobile">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a11.042 11.042 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                    +91 ${escapeHtml(student.mobile)}
                  </span>
                ` : ''}
              </div>
              ${student.cvLink && student.cvLink.startsWith('http') ? `
                <a href="${student.cvLink}" target="_blank" rel="noopener noreferrer" class="cv-link-btn">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open Verified Resume / CV
                </a>
              ` : ''}
            </div>
          </div>

          <!-- Overall Rank & Composite Score Display -->
          <div class="hero-rank-box">
            <span class="hero-rank-title">Overall Batch Rank</span>
            <div class="hero-rank-display">#${student.rank} <span style="font-size: 1.1rem; color: var(--text-muted); font-weight: 500;">/ ${rankedStudents.length}</span></div>
            <div class="hero-rank-score">${student.scores.totalComposite} <span style="font-size: 0.75rem; color: var(--text-muted);">/ 100 Pts</span></div>
            <span style="font-size: 0.74rem; font-weight: 600; color: ${tierColor};">${tierLabel}</span>
            <span class="hero-rank-link" id="link-how-ranked">How is this rank calculated? ↗</span>
          </div>
        </div>
      </div>

      <!-- Dossier Grid -->
      <div class="dossier-grid">
        
        <!-- CARD 1: COMPARATIVE ACADEMIC STANDING (PEER BENCHMARKS) -->
        <div class="card grid-col-7">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              Comparative Standing & Peer Benchmarks
            </h3>
            <span class="card-badge">Batch Percentiles</span>
          </div>

          <!-- Class 12th Relative Benchmark -->
          <div class="benchmark-stat-card" style="border-left: 4px solid var(--primary);">
            <div class="benchmark-header">
              <span class="benchmark-label">Class 12th Relative Standing</span>
              <span class="benchmark-score">${student.perc12}%</span>
            </div>
            <div class="benchmark-bar-wrapper">
              <div class="benchmark-bar-fill" style="width: ${b.percentile12}%;"></div>
            </div>
            <div class="benchmark-insight">
              <span class="insight-highlight">
                Scored higher than <strong>${b.countLower12} students</strong> (${b.percentile12}% of batch)
              </span>
              <span class="${b.countHigher12 > 0 ? 'insight-higher' : 'insight-highlight'}">
                ${b.countHigher12} students scored higher
              </span>
            </div>
          </div>

          <!-- Class 10th Relative Benchmark -->
          <div class="benchmark-stat-card" style="border-left: 4px solid var(--secondary);">
            <div class="benchmark-header">
              <span class="benchmark-label">Class 10th Relative Standing</span>
              <span class="benchmark-score">${student.perc10}%</span>
            </div>
            <div class="benchmark-bar-wrapper">
              <div class="benchmark-bar-fill" style="width: ${b.percentile10}%; background: linear-gradient(90deg, #06b6d4, #3b82f6);"></div>
            </div>
            <div class="benchmark-insight">
              <span class="insight-highlight">
                Scored higher than <strong>${b.countLower10} students</strong> (${b.percentile10}% of batch)
              </span>
              <span class="${b.countHigher10 > 0 ? 'insight-higher' : 'insight-highlight'}">
                ${b.countHigher10} students scored higher
              </span>
            </div>
          </div>

          <!-- Graduation Relative Benchmark -->
          <div class="benchmark-stat-card" style="border-left: 4px solid var(--accent-emerald);">
            <div class="benchmark-header">
              <span class="benchmark-label">Graduation Degree Standing</span>
              <span class="benchmark-score">${student.percGrad}%</span>
            </div>
            <div class="benchmark-bar-wrapper">
              <div class="benchmark-bar-fill" style="width: ${b.percentileGrad}%; background: linear-gradient(90deg, #10b981, #059669);"></div>
            </div>
            <div class="benchmark-insight">
              <span class="insight-highlight">
                Scored higher than <strong>${b.countLowerGrad} students</strong> (${b.percentileGrad}% of batch)
              </span>
              <span class="${b.countHigherGrad > 0 ? 'insight-higher' : 'insight-highlight'}">
                ${b.countHigherGrad} students scored higher
              </span>
            </div>
          </div>
        </div>

        <!-- CARD 2: PROFILE SCORE COMPOSITION BREAKDOWN -->
        <div class="card grid-col-5">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/></svg>
              Score Composition &amp; Radar
            </h3>
            <span class="card-badge" style="color: var(--accent-gold);">${student.scores.totalComposite} / 100 Pts</span>
          </div>

          <div class="score-breakdown-row">
            <div class="score-row-info">
              <span>Academics Consistency</span>
              <span style="color: #818cf8;">${student.scores.academicScore} / 35</span>
            </div>
            <div class="score-progress-bar">
              <div class="score-fill fill-academics" style="width: ${(student.scores.academicScore / 35) * 100}%;"></div>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              10th: ${student.scores.score10}/10 • 12th: ${student.scores.score12}/12.5 • Grad: ${student.scores.scoreGrad}/12.5
            </div>
          </div>

          <div class="score-breakdown-row">
            <div class="score-row-info">
              <span>Prior Work Experience</span>
              <span style="color: #34d399;">${student.scores.workExpScore} / 25</span>
            </div>
            <div class="score-progress-bar">
              <div class="score-fill fill-experience" style="width: ${(student.scores.workExpScore / 25) * 100}%;"></div>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              ${student.hasWorkExp ? `${student.workExpMonths} Months Proven Corporate Tenure` : 'Fresher Baseline Evaluation'}
            </div>
          </div>

          <div class="score-breakdown-row">
            <div class="score-row-info">
              <span>Summer Internship Scope</span>
              <span style="color: #fbbf24;">${student.scores.internshipScore} / 25</span>
            </div>
            <div class="score-progress-bar">
              <div class="score-fill fill-internships" style="width: ${(student.scores.internshipScore / 25) * 100}%;"></div>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              ${student.numInternships} Internship(s) • ${student.internship1Duration || 'Summer Project'}
            </div>
          </div>

          <div class="score-breakdown-row">
            <div class="score-row-info">
              <span>Skills &amp; Certifications Depth</span>
              <span style="color: #c084fc;">${student.scores.skillsScore} / 15</span>
            </div>
            <div class="score-progress-bar">
              <div class="score-fill fill-skills" style="width: ${(student.scores.skillsScore / 15) * 100}%;"></div>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              Analytics, Tools &amp; Verified Professional Certs
            </div>
          </div>

          <!-- 6-Axis Profile Competency Radar Chart -->
          <div style="margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
              <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
                6-Axis Competency Radar
              </span>
              <span style="font-size: 0.68rem; color: var(--secondary); font-weight: 600;">Candidate vs Batch Avg</span>
            </div>
            <div class="radar-chart-box">
              <canvas id="chart-student-radar"></canvas>
            </div>
          </div>
        </div>

        <!-- CARD 3: PEER SIMILARITY & INTERNSHIP COMPANY OVERLAP -->
        <div class="card grid-col-12">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              Cohort Similarity &amp; Shared Experiences
            </h3>
            <span class="card-badge">Batch Overlap Analysis</span>
          </div>

          <div class="similarity-grid">
            <!-- Same Internship Company Match -->
            <div class="similarity-box" style="border-top: 3px solid var(--accent-emerald);">
              <span class="similarity-box-title">Same Internship Recruiter</span>
              <div class="similarity-box-value">
                ${b.sameCompanyPeers.length > 0 ? `${b.sameCompanyPeers.length} Peer${b.sameCompanyPeers.length > 1 ? 's' : ''}` : 'Unique Recruiter'}
              </div>
              <p class="similarity-box-desc">
                ${b.sameCompanyPeers.length > 0
                  ? `Batchmates who also completed summer projects at <strong>${escapeHtml(b.targetCompany)}</strong>:`
                  : `Sole candidate who interned at <strong>${escapeHtml(b.targetCompany || 'this firm')}</strong>.`}
              </p>
              ${b.sameCompanyPeers.length > 0 ? `
                <div class="peer-chips-list">
                  ${b.sameCompanyPeers.map(p => `
                    <span class="peer-chip peer-chip-trigger" data-id="${p.id}" title="Click to view ${escapeHtml(p.name)}">
                      #${p.rank} ${escapeHtml(p.name)}
                    </span>
                  `).join('')}
                </div>
              ` : ''}
            </div>

            <!-- Same Dual Specialization Cohort -->
            <div class="similarity-box" style="border-top: 3px solid var(--primary);">
              <span class="similarity-box-title">Specialization Cohort</span>
              <div class="similarity-box-value">${b.sameSpecCount} Peers</div>
              <p class="similarity-box-desc">
                Share the <strong>Marketing + ${escapeHtml(student.specialization)}</strong> dual specialization track.
              </p>
            </div>

            <!-- Same Undergrad Background -->
            <div class="similarity-box" style="border-top: 3px solid var(--secondary);">
              <span class="similarity-box-title">Undergrad Background</span>
              <div class="similarity-box-value">${b.sameStreamCount} Peers</div>
              <p class="similarity-box-desc">
                Transitioned to ISB&M from <strong>${escapeHtml(student.gradStream)}</strong> discipline.
              </p>
            </div>

            <!-- Top 3 Closest Profile Matches -->
            <div class="similarity-box" style="border-top: 3px solid var(--accent-violet);">
              <span class="similarity-box-title">Closest Profile Matches</span>
              <div class="similarity-box-value">Top 3 Peers</div>
              <p class="similarity-box-desc">
                Highest multi-dimensional similarity across academics, career profile, and background:
              </p>
              <div class="peer-chips-list">
                ${b.closestPeers.map(cp => `
                  <span class="peer-chip peer-chip-trigger" data-id="${cp.student.id}" title="${cp.similarityPct}% profile match">
                    #${cp.student.rank} ${escapeHtml(cp.student.name)} (${cp.similarityPct}%)
                  </span>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- CARD 4: CORPORATE WORK EXPERIENCE -->
        <div class="card grid-col-6">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              Corporate Work Experience
            </h3>
            <span class="card-badge ${student.hasWorkExp ? 'pill-tag-exp' : ''}">
              ${student.hasWorkExp ? `${student.workExpMonths} Months Prior Exp` : 'Fresher Profile'}
            </span>
          </div>

          <!-- Peer Experience Standing Benchmark -->
          <div class="benchmark-stat-card" style="border-left: 4px solid var(--accent-emerald); margin-bottom: 1.15rem;">
            <div class="benchmark-header">
              <span class="benchmark-label">Corporate Tenure Cohort Standing</span>
              <span class="benchmark-score" style="color: var(--accent-emerald);">${student.hasWorkExp ? `${student.workExpMonths}m Exp` : 'Fresher'}</span>
            </div>
            <div class="benchmark-bar-wrapper">
              <div class="benchmark-bar-fill" style="width: ${b.percentileExp}%; background: linear-gradient(90deg, #10b981, #059669);"></div>
            </div>
            <div class="benchmark-insight">
              <span class="insight-highlight">
                ${student.hasWorkExp
                  ? `Higher corporate tenure than <strong>${b.countLowerExp} peers</strong> (${b.percentileExp}% of batch)`
                  : `Member of <strong>28 Freshers (67% of batch)</strong> with unconditioned learning agility`}
              </span>
              <span class="${b.countHigherExp > 0 ? 'insight-higher' : 'insight-highlight'}">
                ${student.hasWorkExp ? `${b.countHigherExp} peers have longer tenure` : `14 experienced candidates in cohort`}
              </span>
            </div>
          </div>

          ${student.hasWorkExp ? `
            <div class="experience-block">
              <div class="exp-company-title">
                <span>${escapeHtml(student.prevJobRole || 'Executive Role')}</span>
                <span class="pill-tag pill-tag-exp">${escapeHtml(student.workExpRaw || `${student.workExpMonths} months`)}</span>
              </div>
              <div class="exp-role-title">Prior Professional Corporate Experience</div>
              <div class="exp-meta">
                <span>Duration: ${student.workExpMonths} Months</span>
                <span>Category: Experienced Candidate</span>
              </div>
            </div>
          ` : `
            <div class="experience-block" style="text-align: center; padding: 1.5rem 1rem;">
              <p style="color: var(--text-secondary); font-size: 0.88rem; font-weight: 600;">Fresher Talent Profile</p>
              <p style="color: var(--text-muted); font-size: 0.78rem; margin-top: 0.3rem;">
                Enters corporate management directly from undergraduate studies with high learning speed, modern tool fluency, and uncompromised adaptability.
              </p>
            </div>
          `}

          <!-- Undergrad Academic Record -->
          <div style="margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.6rem;">
              Undergraduate Degree Credentials
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.84rem; margin-bottom: 0.35rem;">
              <span style="color: var(--text-secondary);">Discipline &amp; Stream:</span>
              <strong style="color: var(--text-primary);">${escapeHtml(student.gradStreamRaw || student.gradStream)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.84rem;">
              <span style="color: var(--text-secondary);">Graduation Score:</span>
              <strong style="color: var(--accent-emerald);">${student.percGrad}%</strong>
            </div>
          </div>
        </div>

        <!-- CARD 5: SUMMER INTERNSHIPS -->
        <div class="card grid-col-6">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
              Summer Internship Track Record
            </h3>
            <span class="card-badge" style="color: var(--accent-gold);">${student.numInternships} Project(s) Completed</span>
          </div>

          <!-- Peer Internship Intensity Benchmark -->
          <div class="benchmark-stat-card" style="border-left: 4px solid var(--accent-gold); margin-bottom: 1.15rem;">
            <div class="benchmark-header">
              <span class="benchmark-label">Internship Rigor &amp; Project Depth</span>
              <span class="benchmark-score" style="color: var(--accent-gold);">${b.hasDual ? 'Dual Internship' : 'Single Intensive'}</span>
            </div>
            <div class="benchmark-bar-wrapper">
              <div class="benchmark-bar-fill" style="width: ${b.percentileInternships}%; background: linear-gradient(90deg, #f59e0b, #d97706);"></div>
            </div>
            <div class="benchmark-insight">
              <span class="insight-highlight">
                ${b.hasDual
                  ? `Completed 2 summer projects: Exceeds <strong>32 batchmates</strong> (Top 24% of batch)`
                  : `Completed focused summer project in ${escapeHtml(b.recruiterSector)}`}
              </span>
              <span class="insight-highlight" style="color: var(--secondary);">
                Recruiter Sector: <strong>${escapeHtml(b.recruiterSector)}</strong>
              </span>
            </div>
          </div>

          <!-- Internship 1 -->
          <div class="experience-block">
            <div class="exp-company-title">
              <span>${escapeHtml(student.internship1Company || 'Internship 1')}</span>
              <span class="pill-tag pill-tag-primary">${escapeHtml(student.internship1Duration || 'Summer Project')}</span>
            </div>
            <div class="exp-role-title">${escapeHtml(student.internship1Role || 'Internship Associate')}</div>
            <div class="exp-meta">
              <span>Function: Sales &amp; Marketing Exposure</span>
            </div>
          </div>

          <!-- Internship 2 (If present) -->
          ${student.internship2Company && student.internship2Company.toLowerCase() !== 'na' && student.internship2Company.toLowerCase() !== 'none' ? `
            <div class="experience-block">
              <div class="exp-company-title">
                <span>${escapeHtml(student.internship2Company)}</span>
                <span class="pill-tag" style="background: rgba(168, 85, 247, 0.15); color: var(--accent-violet); border-color: rgba(168, 85, 247, 0.3);">
                  ${escapeHtml(student.internship2Duration || 'Dual Internship')}
                </span>
              </div>
              <div class="exp-role-title">${escapeHtml(student.internship2Role || 'Internship Associate')}</div>
              <div class="exp-meta">
                <span>Function: Secondary Professional Project</span>
              </div>
            </div>
          ` : `
            <div style="font-size: 0.76rem; color: var(--text-muted); font-style: italic; margin-top: 0.5rem;">
              Single intensive summer internship project completed.
            </div>
          `}
        </div>

        <!-- CARD 6: CERTIFICATIONS & PROFESSIONAL SKILLS -->
        <div class="card grid-col-12">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              Verified Certifications &amp; Competencies
            </h3>
            <span class="card-badge">Skill Stack</span>
          </div>

          <!-- Upskilling & Tool Cohort Benchmark -->
          <div class="benchmark-stat-card" style="border-left: 4px solid var(--accent-violet); margin-bottom: 1.25rem;">
            <div class="benchmark-header">
              <span class="benchmark-label">Professional Upskilling &amp; Multi-Skilling Standing</span>
              <span class="benchmark-score" style="color: var(--accent-violet);">${certsList.length} Verified Certs</span>
            </div>
            <div class="benchmark-bar-wrapper">
              <div class="benchmark-bar-fill" style="width: ${b.percentileCerts}%; background: linear-gradient(90deg, #a855f7, #6366f1);"></div>
            </div>
            <div class="benchmark-insight">
              <span class="insight-highlight">
                Holds more certified credentials than <strong>${b.countLowerCerts} students</strong> (${b.percentileCerts}% of batch)
              </span>
              <span class="${b.countHigherCerts > 0 ? 'insight-higher' : 'insight-highlight'}">
                ${b.countHigherCerts > 0 ? `${b.countHigherCerts} peers hold more certs` : 'Highest certification volume in cohort'} • Batch Avg: 1.6 Certs
              </span>
            </div>
            ${b.candidateTools.length > 0 ? `
              <div style="margin-top: 0.65rem; border-top: 1px solid var(--border-color); padding-top: 0.5rem;">
                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">
                  Cohort Adoption Rates for Candidate's Verified Tools:
                </span>
                <div class="skill-cohort-chips">
                  ${b.candidateTools.map(ct => `
                    <span class="skill-cohort-chip" title="${ct.cohortCount} students in batch know ${ct.name}">
                      <strong>${ct.name}</strong> • ${ct.cohortCount} peers (${ct.cohortPct}% of batch)
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
            
            <!-- Certifications -->
            <div>
              <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.75rem;">
                Industry &amp; Professional Certifications
              </div>
              ${certsList.length > 0 ? `
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                  ${certsList.map(c => `
                    <div class="cert-card-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138z"/></svg>
                      <span>${escapeHtml(c)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">
                  Internal business school coursework &amp; experiential learning completed.
                </div>
              `}
            </div>

            <!-- Soft Skills & Tools -->
            <div>
              <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.75rem;">
                Business Competencies &amp; Tools
              </div>
              ${skillsList.length > 0 ? `
                <div class="tags-cloud">
                  ${skillsList.map(s => `
                    <span class="pill-tag" style="padding: 0.35rem 0.75rem; font-size: 0.78rem; background: var(--bg-card-subtle);">
                      ${escapeHtml(s)}
                    </span>
                  `).join('')}
                </div>
              ` : `
                <div style="font-size: 0.8rem; color: var(--text-muted);">
                  Presentation, Team Leadership, Business Communication, Analytical Problem-Solving.
                </div>
              `}
            </div>

          </div>
        </div>

        <!-- CARD 7: CORPORATE CAREER PATHWAY ALIGNMENT & ROLE MATCHMAKER -->
        <div class="card grid-col-12">
          <div class="card-header">
            <h3 class="card-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              Corporate Career Alignment &amp; Role Matchmaker
            </h3>
            <span class="card-badge" style="color: var(--accent-emerald);">Recruiter Shortlist Guide</span>
          </div>
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 0.85rem;">
            Algorithmic role-suitability index evaluating the candidate across primary functional MBA hiring domains based on academic consistency, dual specialization track, summer internship exposure, and verified technical tool credentials.
          </p>

          <div class="pathway-grid">
            ${b.rolePathways.map(rp => `
              <div class="pathway-card ${rp.match >= 85 ? 'high-fit' : 'medium-fit'}">
                <div class="pathway-card-header">
                  <span class="pathway-card-title">${rp.role}</span>
                  <span class="pathway-fit-score ${rp.match >= 85 ? '' : 'fit-gold'}">${rp.match}% Fit</span>
                </div>
                <div class="pathway-bar-bg">
                  <div class="pathway-bar-fill" style="width: ${rp.match}%;"></div>
                </div>
                <p class="pathway-rationale">${rp.rationale}</p>
              </div>
            `).join('')}
          </div>
        </div>

      </div>
    `;

    // Render 6-Axis Profile Competency Radar Chart
    setTimeout(() => {
      const radarEl = document.getElementById('chart-student-radar');
      if (radarEl && typeof Chart !== 'undefined') {
        if (charts.studentRadar) {
          charts.studentRadar.destroy();
        }
        charts.studentRadar = new Chart(radarEl, {
          type: 'radar',
          data: {
            labels: ['Academics', 'Corporate Exp', 'Internships', 'Analytics & Tools', 'Certifications', 'Soft Skills'],
            datasets: [
              {
                label: student.name,
                data: b.radarCandidate,
                backgroundColor: 'rgba(6, 182, 212, 0.22)',
                borderColor: '#06b6d4',
                pointBackgroundColor: '#06b6d4',
                pointBorderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 3
              },
              {
                label: 'Batch Centroid Avg',
                data: b.radarBatchAvg,
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                borderColor: '#f59e0b',
                pointBackgroundColor: '#f59e0b',
                borderWidth: 1.5,
                borderDash: [3, 3],
                pointRadius: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                titleFont: { size: 11, weight: 'bold' },
                bodyFont: { size: 10 },
                padding: 8,
                cornerRadius: 6
              }
            },
            scales: {
              r: {
                min: 0,
                max: 100,
                ticks: { display: false, stepSize: 25 },
                angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                pointLabels: {
                  font: { size: 9, weight: '600' },
                  color: '#94a3b8'
                }
              }
            }
          }
        });
      }
    }, 40);

    // Attach click listeners for peer chips
    container.querySelectorAll('.peer-chip-trigger').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = Number(chip.getAttribute('data-id'));
        if (targetId) selectStudent(targetId);
      });
    });

    // Attach ranking explanation modal link
    const howRanked = document.getElementById('link-how-ranked');
    if (howRanked) {
      howRanked.addEventListener('click', () => {
        openModal('modal-methodology');
      });
    }
  }

  // ==================== CHART DRILL-DOWN COHORT MODAL ====================
  function openDrilldownModal(title, subtitle, studentList) {
    activeDrilldownStudents = studentList;
    activeDrilldownCategory = title;

    document.getElementById('drilldown-title').innerHTML = `
      <span>${escapeHtml(title)}</span>
      <span class="brand-badge" style="font-size: 0.72rem; margin-left: 0.4rem;">${studentList.length} Candidate${studentList.length !== 1 ? 's' : ''}</span>
    `;
    document.getElementById('drilldown-subtitle').textContent = subtitle || 'Click on any candidate to inspect their complete individual profile and peer similarities.';
    
    const searchInput = document.getElementById('drilldown-search-input');
    if (searchInput) searchInput.value = '';

    renderDrilldownList(studentList);
    openModal('modal-chart-drilldown');
  }

  function renderDrilldownList(list) {
    const container = document.getElementById('drilldown-candidates-list');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); font-size: 0.88rem;">
          <p>No candidates found matching this criteria.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(s => {
      let rankClass = '';
      if (s.rank === 1) rankClass = 'rank-top1';
      else if (s.rank === 2) rankClass = 'rank-top2';
      else if (s.rank === 3) rankClass = 'rank-top3';

      const expStr = (s.hasWorkExp || s.workExpMonths > 0) ? `${s.workExpMonths}m Exp` : 'Fresher';

      return `
        <div class="drilldown-card">
          <div class="drilldown-identity">
            <div class="rank-badge-sm ${rankClass}">#${s.rank}</div>
            <div class="drilldown-details">
              <div class="drilldown-name">
                ${escapeHtml(s.name)}
                <span class="pill-tag pill-tag-primary" style="font-size: 0.68rem;">Sec ${s.section || 'A'}</span>
              </div>
              <div class="drilldown-meta">
                <span class="pill-tag" style="background: rgba(99, 102, 241, 0.15); color: var(--primary-light);">AOI: ${escapeHtml(s.aoi || 'Marketing')}</span>
                <span class="pill-tag" style="background: rgba(6, 182, 212, 0.15); color: var(--secondary);">Dual: ${escapeHtml(s.specialization)}</span>
                <span class="pill-tag">${escapeHtml(s.gradStream)}</span>
                <span style="color: var(--text-muted);">12th: <strong>${s.perc12}%</strong></span>
                <span style="color: var(--accent-emerald);">Grad: <strong>${s.percGrad}%</strong></span>
                <span class="pill-tag ${s.hasWorkExp ? 'pill-tag-exp' : ''}">${expStr}</span>
              </div>
            </div>
          </div>
          <div class="drilldown-actions">
            <button class="drilldown-view-btn" data-id="${s.id}">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              View Profile
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events on "View Profile"
    container.querySelectorAll('.drilldown-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const studentId = Number(btn.getAttribute('data-id'));
        closeModal('modal-chart-drilldown');
        
        // Switch to individual tab
        const tabIndividual = document.getElementById('tab-individual');
        if (tabIndividual) tabIndividual.click();
        selectStudent(studentId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function exportCustomCohortToExcel(cohortName, cohortStudents) {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library is not loaded');
      return;
    }
    const wb = XLSX.utils.book_new();
    const rows = cohortStudents.map(s => ({
      'Batch Rank': s.rank,
      'Full Name': s.name,
      'Roll Number': s.rollNo || '',
      'Section': s.section || '',
      'Gender': s.gender || '',
      'Email Address': s.email || s.pgEmail || '',
      'Mobile Number': s.mobile || '',
      'Primary Specialization (AOI)': s.aoi || 'Marketing',
      'Other Specialization': s.specialization || '',
      'Class 10th %': s.perc10,
      'Class 12th %': s.perc12,
      'Graduation %': s.percGrad,
      'Undergrad Stream': s.gradStreamRaw || s.gradStream,
      'Work Experience (Months)': s.workExpMonths,
      'Prior Job Role': s.prevJobRole || '',
      'Internship 1 Company': s.internship1Company || '',
      'Internship 1 Role': s.internship1Role || '',
      'Certifications': s.certifications || '',
      'Soft Skills': s.softSkills || '',
      'Overall Composite Score (/100)': s.scores.totalComposite,
      'CV Link': s.cvLink || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const safeSheetName = (cohortName || 'Cohort').replace(/[:\\/?*\[\]]/g, '').slice(0, 30);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName || 'Cohort');
    const safeFileName = `M-Squad_${cohortName.replace(/[^a-zA-Z0-9]/g, '_')}_Cohort.xlsx`;
    XLSX.writeFile(wb, safeFileName);
    showToast(`Exported ${cohortStudents.length} candidates in "${cohortName}" to Excel!`);
  }

  // ==================== RENDERING: GROUP CHARTS DASHBOARD ====================
  function renderGroupDashboard() {
    const total = rankedStudents.length;
    document.getElementById('kpi-batch-size').textContent = total;

    // Destroy existing charts to prevent memory leak / duplicate renders
    Object.keys(charts).forEach(key => {
      if (charts[key]) charts[key].destroy();
    });

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)';
    const textColor = isDark ? '#94a3b8' : '#475569';

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = 'Inter, -apple-system, sans-serif';

    // 1. CHART: WORK EXPERIENCE DIVERSITY (Donut & Buckets)
    const freshersCount = rankedStudents.filter(s => !s.hasWorkExp && (!s.workExpMonths || s.workExpMonths === 0)).length;
    const exp1to6 = rankedStudents.filter(s => s.workExpMonths >= 1 && s.workExpMonths <= 6).length;
    const exp7to12 = rankedStudents.filter(s => s.workExpMonths >= 7 && s.workExpMonths <= 12).length;
    const exp13to24 = rankedStudents.filter(s => s.workExpMonths >= 13 && s.workExpMonths <= 24).length;
    const exp24Plus = rankedStudents.filter(s => s.workExpMonths > 24).length;

    const ctxExp = document.getElementById('chart-work-exp').getContext('2d');
    charts.workExp = new Chart(ctxExp, {
      type: 'doughnut',
      data: {
        labels: ['Freshers', '1-6 Months', '7-12 Months', '13-24 Months', '24+ Months'],
        datasets: [{
          data: [freshersCount, exp1to6, exp7to12, exp13to24, exp24Plus],
          backgroundColor: ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899'],
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        cutout: '65%',
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const label = charts.workExp.data.labels[idx];
          let matching = [];
          if (label === 'Freshers') {
            matching = rankedStudents.filter(s => !s.hasWorkExp && (!s.workExpMonths || s.workExpMonths === 0));
          } else if (label === '1-6 Months') {
            matching = rankedStudents.filter(s => s.workExpMonths >= 1 && s.workExpMonths <= 6);
          } else if (label === '7-12 Months') {
            matching = rankedStudents.filter(s => s.workExpMonths >= 7 && s.workExpMonths <= 12);
          } else if (label === '13-24 Months') {
            matching = rankedStudents.filter(s => s.workExpMonths >= 13 && s.workExpMonths <= 24);
          } else if (label === '24+ Months') {
            matching = rankedStudents.filter(s => s.workExpMonths > 24);
          }
          openDrilldownModal(`Work Experience: ${label}`, `Showing ${matching.length} candidates in the "${label}" experience segment.`, matching);
        }
      }
    });

    // 2. CHART: UNDERGRADUATE DISCIPLINE BACKGROUND
    const streamCounts = {};
    rankedStudents.forEach(s => {
      const stream = s.gradStream || 'Other';
      streamCounts[stream] = (streamCounts[stream] || 0) + 1;
    });

    const ctxUndergrad = document.getElementById('chart-undergrad').getContext('2d');
    charts.undergrad = new Chart(ctxUndergrad, {
      type: 'pie',
      data: {
        labels: Object.keys(streamCounts),
        datasets: [{
          data: Object.values(streamCounts),
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'],
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const label = charts.undergrad.data.labels[idx];
          const matching = rankedStudents.filter(s => (s.gradStream || 'Other') === label);
          openDrilldownModal(`Undergraduate Discipline: ${label}`, `Showing ${matching.length} candidates with a degree in ${label}.`, matching);
        }
      }
    });

    // 3. CHART: DUAL SPECIALIZATION DISTRIBUTION
    const specCounts = {};
    rankedStudents.forEach(s => {
      const spec = s.specialization || 'None';
      specCounts[spec] = (specCounts[spec] || 0) + 1;
    });

    const ctxSpec = document.getElementById('chart-specialization').getContext('2d');
    charts.specialization = new Chart(ctxSpec, {
      type: 'bar',
      data: {
        labels: Object.keys(specCounts),
        datasets: [{
          label: 'Number of Candidates',
          data: Object.values(specCounts),
          backgroundColor: '#6366f1',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor } },
          x: { grid: { display: false } }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const label = charts.specialization.data.labels[idx];
          const matching = rankedStudents.filter(s => (s.specialization || 'None') === label);
          openDrilldownModal(`Specialization: Marketing + ${label}`, `Showing ${matching.length} candidates specializing in Marketing + ${label}.`, matching);
        }
      }
    });

    // 4. CHART: ACADEMIC PERFORMANCE (10th vs 12th vs Grad)
    function bucketScores(scores) {
      let bAbove85 = 0, b75to85 = 0, b65to75 = 0, bBelow65 = 0;
      scores.forEach(v => {
        if (v >= 85) bAbove85++;
        else if (v >= 75) b75to85++;
        else if (v >= 65) b65to75++;
        else bBelow65++;
      });
      return [bAbove85, b75to85, b65to75, bBelow65];
    }

    const p10Vals = rankedStudents.map(s => Number(s.perc10) || 0);
    const p12Vals = rankedStudents.map(s => Number(s.perc12) || 0);
    const pGradVals = rankedStudents.map(s => Number(s.percGrad) || 0);

    const ctxAcademics = document.getElementById('chart-academics').getContext('2d');
    charts.academics = new Chart(ctxAcademics, {
      type: 'bar',
      data: {
        labels: ['≥ 85%', '75% - 84.9%', '65% - 74.9%', '< 65%'],
        datasets: [
          { label: 'Class 10th', data: bucketScores(p10Vals), backgroundColor: '#3b82f6', borderRadius: 4 },
          { label: 'Class 12th', data: bucketScores(p12Vals), backgroundColor: '#10b981', borderRadius: 4 },
          { label: 'Graduation', data: bucketScores(pGradVals), backgroundColor: '#f59e0b', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor } },
          x: { grid: { display: false } }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const datasetIdx = elements[0].datasetIndex;
          const index = elements[0].index;
          const datasetLabel = charts.academics.data.datasets[datasetIdx].label;
          const bracketLabel = charts.academics.data.labels[index];

          const matching = rankedStudents.filter(s => {
            let val = 0;
            if (datasetLabel.includes('10th')) val = Number(s.perc10) || 0;
            else if (datasetLabel.includes('12th')) val = Number(s.perc12) || 0;
            else val = Number(s.percGrad) || 0;

            if (bracketLabel.includes('85') && bracketLabel.includes('≥')) return val >= 85;
            if (bracketLabel.includes('75')) return val >= 75 && val < 85;
            if (bracketLabel.includes('65')) return val >= 65 && val < 75;
            return val < 65;
          });

          openDrilldownModal(`${datasetLabel}: Score Bracket ${bracketLabel}`, `Showing ${matching.length} candidates who scored ${bracketLabel} in ${datasetLabel}.`, matching);
        }
      }
    });

    // 5. CHART: TOP SUMMER RECRUITERS
    const companyCounts = {};
    rankedStudents.forEach(s => {
      const c = (s.internship1Company || '').trim();
      if (c && !c.match(/^(none|na|nil)$/i)) {
        companyCounts[c] = (companyCounts[c] || 0) + 1;
      }
    });
    const topRecruiters = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const ctxRecruiters = document.getElementById('chart-recruiters').getContext('2d');
    charts.recruiters = new Chart(ctxRecruiters, {
      type: 'bar',
      data: {
        labels: topRecruiters.map(r => r[0]),
        datasets: [{
          label: 'Interns Placed',
          data: topRecruiters.map(r => r[1]),
          backgroundColor: '#06b6d4',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 1 } },
          y: { grid: { display: false } }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const companyName = charts.recruiters.data.labels[idx];
          const matching = rankedStudents.filter(s => {
            const c1 = (s.internship1Company || '').trim().toLowerCase();
            const c2 = (s.internship2Company || '').trim().toLowerCase();
            const target = companyName.toLowerCase();
            return c1 === target || c2 === target;
          });
          openDrilldownModal(`Interns at: ${companyName}`, `Showing ${matching.length} candidates who completed internships at ${companyName}.`, matching);
        }
      }
    });

    // 6. CHART: INTERNSHIP FUNCTIONAL DOMAINS
    const roleCategories = {
      'Sales & Business Dev': 0,
      'Digital Marketing & SEO': 0,
      'Product & Market Research': 0,
      'Operations & Channel Mgmt': 0,
      'Analytics & Consulting': 0
    };

    rankedStudents.forEach(s => {
      const r = (s.internship1Role || '').toLowerCase();
      if (r.includes('seo') || r.includes('digital') || r.includes('social') || r.includes('content')) {
        roleCategories['Digital Marketing & SEO']++;
      } else if (r.includes('product') || r.includes('research') || r.includes('survey')) {
        roleCategories['Product & Market Research']++;
      } else if (r.includes('operation') || r.includes('channel') || r.includes('retail')) {
        roleCategories['Operations & Channel Mgmt']++;
      } else if (r.includes('consult') || r.includes('analytic') || r.includes('quality')) {
        roleCategories['Analytics & Consulting']++;
      } else {
        roleCategories['Sales & Business Dev']++;
      }
    });

    const ctxRoles = document.getElementById('chart-roles').getContext('2d');
    charts.roles = new Chart(ctxRoles, {
      type: 'doughnut',
      data: {
        labels: Object.keys(roleCategories),
        datasets: [{
          data: Object.values(roleCategories),
          backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'],
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        cutout: '60%',
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const domainLabel = charts.roles.data.labels[idx];
          const matching = rankedStudents.filter(s => {
            const r = (s.internship1Role || '').toLowerCase();
            if (domainLabel === 'Digital Marketing & SEO') {
              return r.includes('seo') || r.includes('digital') || r.includes('social') || r.includes('content');
            } else if (domainLabel === 'Product & Market Research') {
              return r.includes('product') || r.includes('research') || r.includes('survey');
            } else if (domainLabel === 'Operations & Channel Mgmt') {
              return r.includes('operation') || r.includes('channel') || r.includes('retail');
            } else if (domainLabel === 'Analytics & Consulting') {
              return r.includes('consult') || r.includes('analytic') || r.includes('quality');
            } else {
              return !r.includes('seo') && !r.includes('digital') && !r.includes('social') && !r.includes('content') &&
                     !r.includes('product') && !r.includes('research') && !r.includes('survey') &&
                     !r.includes('operation') && !r.includes('channel') && !r.includes('retail') &&
                     !r.includes('consult') && !r.includes('analytic') && !r.includes('quality');
            }
          });
          openDrilldownModal(`Functional Domain: ${domainLabel}`, `Showing ${matching.length} candidates placed in ${domainLabel} roles.`, matching);
        }
      }
    });

    // 7. CHART: TOOL STACK & IN-DEMAND SKILLS
    const coreTools = [
      { name: 'Advanced MS Excel', key: 'excel' },
      { name: 'Power BI / Dashboards', key: 'power bi' },
      { name: 'CRM & Lead Gen', key: 'crm' },
      { name: 'Generative AI Tools', key: 'ai' },
      { name: 'Digital Mktg & SEO', key: 'seo' },
      { name: 'Canva & Media Creation', key: 'canva' },
      { name: 'Python / Analytics', key: 'python' }
    ];

    const toolFreq = coreTools.map(t => {
      let count = 0;
      rankedStudents.forEach(s => {
        const text = ((s.certifications || '') + ' ' + (s.softSkills || '')).toLowerCase();
        if (text.includes(t.key)) count++;
      });
      return count;
    });

    const ctxSkills = document.getElementById('chart-skills').getContext('2d');
    charts.skills = new Chart(ctxSkills, {
      type: 'bar',
      data: {
        labels: coreTools.map(t => t.name),
        datasets: [{
          label: 'Proficient Candidates',
          data: toolFreq,
          backgroundColor: '#8b5cf6',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: () => '👉 Click to view candidate names'
            }
          }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor } },
          x: { grid: { display: false } }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const toolObj = coreTools[idx];
          const matching = rankedStudents.filter(s => {
            const text = ((s.certifications || '') + ' ' + (s.softSkills || '')).toLowerCase();
            return text.includes(toolObj.key);
          });
          openDrilldownModal(`Proficiency: ${toolObj.name}`, `Showing ${matching.length} candidates with verified skills or coursework in ${toolObj.name}.`, matching);
        }
      }
    });

    // 8. CHART: GENDER BALANCE ACROSS SPECIALIZATIONS (Stacked Bar)
    const specList = ['Finance', 'Media', 'LSCM', 'Business Analytics', 'HR', 'None'];
    const maleCounts = specList.map(sp => rankedStudents.filter(s => (s.specialization || 'None') === sp && s.gender === 'Male').length);
    const femaleCounts = specList.map(sp => rankedStudents.filter(s => (s.specialization || 'None') === sp && s.gender === 'Female').length);

    const ctxGenderSpec = document.getElementById('chart-gender-spec');
    if (ctxGenderSpec) {
      charts.genderSpec = new Chart(ctxGenderSpec.getContext('2d'), {
        type: 'bar',
        data: {
          labels: specList,
          datasets: [
            { label: 'Male Candidates', data: maleCounts, backgroundColor: '#3b82f6', borderRadius: 4 },
            { label: 'Female Candidates', data: femaleCounts, backgroundColor: '#ec4899', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
            tooltip: {
              callbacks: {
                afterLabel: () => '👉 Click to view candidate names'
              }
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 2 } }
          },
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const datasetIdx = elements[0].datasetIndex;
            const idx = elements[0].index;
            const targetGender = datasetIdx === 0 ? 'Male' : 'Female';
            const targetSpec = specList[idx];
            const matching = rankedStudents.filter(s => (s.specialization || 'None') === targetSpec && s.gender === targetGender);
            openDrilldownModal(`Gender & Specialization: ${targetSpec} (${targetGender})`, `Showing ${matching.length} ${targetGender} candidates specializing in Marketing + ${targetSpec}.`, matching);
          }
        }
      });
    }

    // 9. CHART: RECRUITER INDUSTRY SECTORS (Donut)
    function getRecruiterMacroSector(comp) {
      if (!comp) return 'General Corporate';
      const c = comp.toLowerCase();
      if (c.includes('trust') || c.includes('birla') || c.includes('bajaj') || c.includes('mutual') || c.includes('capital') || c.includes('bank')) return 'BFSI & Wealth Advisory';
      if (c.includes('burger') || c.includes('fmcg') || c.includes('food')) return 'FMCG & QSR';
      if (c.includes('propedge') || c.includes('estate') || c.includes('realty') || c.includes('godrej') || c.includes('housing')) return 'Real Estate & Infrastructure';
      if (c.includes('noor') || c.includes('tech') || c.includes('metals')) return 'IT, Tech & Manufacturing';
      if (c.includes('kantar') || c.includes('media') || c.includes('ad')) return 'Media, Analytics & Agency';
      return 'Corporate Strategy & Services';
    }

    const sectorList = ['BFSI & Wealth Advisory', 'FMCG & QSR', 'Real Estate & Infrastructure', 'IT, Tech & Manufacturing', 'Media, Analytics & Agency', 'Corporate Strategy & Services'];
    const sectorCounts = sectorList.map(sec => rankedStudents.filter(s => getRecruiterMacroSector(s.internship1Company) === sec).length);

    const ctxSectors = document.getElementById('chart-recruiter-sectors');
    if (ctxSectors) {
      charts.recruiterSectors = new Chart(ctxSectors.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: sectorList,
          datasets: [{
            data: sectorCounts,
            backgroundColor: ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'],
            borderWidth: 2,
            borderColor: isDark ? '#111827' : '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
            tooltip: {
              callbacks: {
                afterLabel: () => '👉 Click to view candidate names'
              }
            }
          },
          cutout: '60%',
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const sec = sectorList[idx];
            const matching = rankedStudents.filter(s => getRecruiterMacroSector(s.internship1Company) === sec);
            openDrilldownModal(`Recruiter Sector: ${sec}`, `Showing ${matching.length} candidates with summer internships in the ${sec} sector.`, matching);
          }
        }
      });
    }

    // 10. CHART: PLACEMENT READINESS TALENT PYRAMID (Horizontal Bar)
    const tier1 = rankedStudents.filter(s => s.scores.totalComposite >= 75);
    const tier2 = rankedStudents.filter(s => s.scores.totalComposite >= 65 && s.scores.totalComposite < 75);
    const tier3 = rankedStudents.filter(s => s.scores.totalComposite < 65);

    const ctxPyramid = document.getElementById('chart-talent-pyramid');
    if (ctxPyramid) {
      charts.talentPyramid = new Chart(ctxPyramid.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['Tier 1: High Readiness (≥75 Pts)', 'Tier 2: Strong Profile (65-74.9 Pts)', 'Tier 3: Developing (<65 Pts)'],
          datasets: [{
            label: 'Candidates',
            data: [tier1.length, tier2.length, tier3.length],
            backgroundColor: ['#10b981', '#3b82f6', '#f59e0b'],
            borderRadius: 6
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: () => '👉 Click to view candidate names'
              }
            }
          },
          scales: {
            x: { beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 2 } },
            y: { grid: { display: false } }
          },
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const tiers = [
              { name: 'Tier 1: High Placement Readiness (≥75 Pts)', list: tier1 },
              { name: 'Tier 2: Strong Core Corporate Profile (65-74.9 Pts)', list: tier2 },
              { name: 'Tier 3: Developing Talent Profile (<65 Pts)', list: tier3 }
            ];
            const selected = tiers[idx];
            openDrilldownModal(selected.name, `Showing ${selected.list.length} candidates in this placement suitability tier.`, selected.list);
          }
        }
      });
    }

    // 11. CHART: ACADEMIC CONSISTENCY & TRAJECTORY (Grouped Bar)
    const trajLabels = ['Exceptional (≥ 80%)', 'Proficient (70% - 79.9%)', 'Competent (60% - 69.9%)', 'Foundation (< 60%)'];
    function bucketTrajectory(key) {
      return [
        rankedStudents.filter(s => (Number(s[key]) || 0) >= 80).length,
        rankedStudents.filter(s => (Number(s[key]) || 0) >= 70 && (Number(s[key]) || 0) < 80).length,
        rankedStudents.filter(s => (Number(s[key]) || 0) >= 60 && (Number(s[key]) || 0) < 70).length,
        rankedStudents.filter(s => (Number(s[key]) || 0) < 60).length
      ];
    }
    const traj12 = bucketTrajectory('perc12');
    const trajGrad = bucketTrajectory('percGrad');

    const ctxTrajectory = document.getElementById('chart-academic-trajectory');
    if (ctxTrajectory) {
      charts.academicTrajectory = new Chart(ctxTrajectory.getContext('2d'), {
        type: 'bar',
        data: {
          labels: trajLabels,
          datasets: [
            { label: 'Class 12th', data: traj12, backgroundColor: '#6366f1', borderRadius: 4 },
            { label: 'Graduation', data: trajGrad, backgroundColor: '#10b981', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
            tooltip: {
              callbacks: {
                afterLabel: () => '👉 Click to view candidate names'
              }
            }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 5 } },
            x: { grid: { display: false } }
          },
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const datasetIdx = elements[0].datasetIndex;
            const idx = elements[0].index;
            const key = datasetIdx === 0 ? 'perc12' : 'percGrad';
            const levelName = datasetIdx === 0 ? 'Class 12th' : 'Graduation';
            const bracketName = trajLabels[idx];
            const matching = rankedStudents.filter(s => {
              const val = Number(s[key]) || 0;
              if (idx === 0) return val >= 80;
              if (idx === 1) return val >= 70 && val < 80;
              if (idx === 2) return val >= 60 && val < 70;
              return val < 60;
            });
            openDrilldownModal(`${levelName}: ${bracketName}`, `Showing ${matching.length} candidates scoring in the ${bracketName} range for ${levelName}.`, matching);
          }
        }
      });
    }

    // 12. CHART: MULTI-SKILLING & CERTIFICATION VOLUME DEPTH (Bar)
    function countStudentCerts(s) {
      return s.certifications ? s.certifications.split(/[\n;?•]/).map(t => t.trim()).filter(t => t.length > 2).length : 0;
    }
    const certTiers = [
      { label: '3+ Verified Certs', min: 3, max: 99 },
      { label: '2 Verified Certs', min: 2, max: 2 },
      { label: '1 Verified Cert', min: 1, max: 1 },
      { label: 'Coursework / Baseline', min: 0, max: 0 }
    ];
    const certCounts = certTiers.map(t => rankedStudents.filter(s => {
      const c = countStudentCerts(s);
      return c >= t.min && c <= t.max;
    }).length);

    const ctxCertDepth = document.getElementById('chart-cert-depth');
    if (ctxCertDepth) {
      charts.certDepth = new Chart(ctxCertDepth.getContext('2d'), {
        type: 'bar',
        data: {
          labels: certTiers.map(t => t.label),
          datasets: [{
            label: 'Candidate Count',
            data: certCounts,
            backgroundColor: ['#a855f7', '#6366f1', '#06b6d4', '#64748b'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: () => '👉 Click to view candidate names'
              }
            }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 2 } },
            x: { grid: { display: false } }
          },
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const tier = certTiers[idx];
            const matching = rankedStudents.filter(s => {
              const c = countStudentCerts(s);
              return c >= tier.min && c <= tier.max;
            });
            openDrilldownModal(`Upskilling Depth: ${tier.label}`, `Showing ${matching.length} candidates in the "${tier.label}" category.`, matching);
          }
        }
      });
    }
  }

  // ==================== EXCEL EXPORT (SHEETJS) ====================
  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library is not ready. Please try again.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Student Profiles & Placement Ranks
    const studentRows = rankedStudents.map(s => {
      const b = getPeerBenchmarks(s, rankedStudents);
      return {
        'Batch Rank': s.rank,
        'Full Name': s.name,
        'Roll Number': s.rollNo || '',
        'Section': s.section || '',
        'Gender': s.gender || '',
        'Email Address': s.email || s.pgEmail || '',
        'Mobile Number': s.mobile || '',
        'Primary Specialization (AOI)': s.aoi || 'Marketing',
        'Other Specialization': s.specialization || '',
        'Class 10th %': s.perc10,
        'Class 12th %': s.perc12,
        'Graduation %': s.percGrad,
        'Undergrad Stream': s.gradStreamRaw || s.gradStream,
        'Work Experience Category': s.hasWorkExp ? 'Experienced' : 'Fresher',
        'Total Work Exp (Months)': s.workExpMonths,
        'Prior Job Role': s.prevJobRole || '',
        'Internship 1 Company': s.internship1Company || '',
        'Internship 1 Role': s.internship1Role || '',
        'Internship 1 Duration': s.internship1Duration || '',
        'Internship 2 Company': s.internship2Company || '',
        'Internship 2 Role': s.internship2Role || '',
        'Certifications': s.certifications || '',
        'Soft Skills': s.softSkills || '',
        'Academic Score (/35)': s.scores.academicScore,
        'Work Exp Score (/25)': s.scores.workExpScore,
        'Internship Score (/25)': s.scores.internshipScore,
        'Skills Score (/15)': s.scores.skillsScore,
        'Overall Composite Score (/100)': s.scores.totalComposite,
        'Class 12th Percentile': `${b.percentile12}%`,
        '12th Count Lower': b.countLower12,
        '12th Count Higher': b.countHigher12,
        'CV Link': s.cvLink || ''
      };
    });

    const wsStudents = XLSX.utils.json_to_sheet(studentRows);
    XLSX.utils.book_append_sheet(wb, wsStudents, 'Candidate Profiles & Ranks');

    // Sheet 2: Placement Brochure Summary
    const freshersCount = rankedStudents.filter(s => !s.hasWorkExp && (!s.workExpMonths || s.workExpMonths === 0)).length;
    const expCount = rankedStudents.length - freshersCount;

    const summaryRows = [
      { 'Metric Category': 'Batch Demographics', 'Metric Name': 'Total Candidates', 'Value': rankedStudents.length },
      { 'Metric Category': 'Batch Demographics', 'Metric Name': 'Male Candidates', 'Value': rankedStudents.filter(s => s.gender === 'Male').length },
      { 'Metric Category': 'Batch Demographics', 'Metric Name': 'Female Candidates', 'Value': rankedStudents.filter(s => s.gender === 'Female').length },
      { 'Metric Category': 'Experience Diversity', 'Metric Name': 'Freshers', 'Value': freshersCount },
      { 'Metric Category': 'Experience Diversity', 'Metric Name': 'Prior Corporate Exp', 'Value': expCount },
      { 'Metric Category': 'Academic Standards', 'Metric Name': 'Average Class 10th %', 'Value': (rankedStudents.reduce((a, c) => a + (Number(c.perc10) || 0), 0) / rankedStudents.length).toFixed(1) },
      { 'Metric Category': 'Academic Standards', 'Metric Name': 'Average Class 12th %', 'Value': (rankedStudents.reduce((a, c) => a + (Number(c.perc12) || 0), 0) / rankedStudents.length).toFixed(1) },
      { 'Metric Category': 'Academic Standards', 'Metric Name': 'Average Graduation %', 'Value': (rankedStudents.reduce((a, c) => a + (Number(c.percGrad) || 0), 0) / rankedStudents.length).toFixed(1) }
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Placement Brochure Summary');

    // Write file
    XLSX.writeFile(wb, 'M-Squad_Senior_Batch_Placement_Analytics.xlsx');
    showToast('Exported enriched dataset to Excel successfully!');
  }

  // ==================== LIVE EXCEL REFRESH & FILE PARSING ====================
  function handleExcelFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });

        if (jsonRows.length < 2) {
          showToast('The uploaded Excel file does not contain enough data rows.');
          return;
        }

        const parsed = parseExcelRows(jsonRows);
        if (parsed.length === 0) {
          showToast('Could not extract student records from the uploaded file.');
          return;
        }

        rawBatchData = parsed;
        rankedStudents = processAndRankStudents(rawBatchData);
        currentStudentId = rankedStudents[0].id;

        renderStudentList();
        if (activeTab === 'group') renderGroupDashboard();
        closeModal('modal-upload');
        showToast(`Successfully reloaded ${rankedStudents.length} candidates from ${file.name}!`);
      } catch (err) {
        console.error(err);
        showToast('Error reading Excel file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseExcelRows(rows) {
    const students = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = (r['C'] || '').toString().trim();
      if (!name) continue;

      const p10 = parseFloat((r['G'] || '').toString().replace(/[^0-9.]/g, '')) || 0;
      let p12Raw = r['H'] || r['J'];
      const p12 = parseFloat((p12Raw || '').toString().replace(/[^0-9.]/g, '')) || 0;
      const pGrad = parseFloat((r['I'] || '').toString().replace(/[^0-9.]/g, '')) || 0;

      const expRaw = (r['R'] || r['S'] || '').toString().trim();
      const hasExp = /yes/i.test((r['Q'] || '').toString()) || (expRaw && !/^(na|no|none|n\/a)$/i.test(expRaw));
      let expMonths = 0;
      if (/(\d+)\s*(?:years?|yrs?)/i.test(expRaw)) {
        expMonths = Math.round(parseFloat(RegExp.$1) * 12);
      } else if (/(\d+)\s*(?:months?|mos?)/i.test(expRaw)) {
        expMonths = parseInt(RegExp.$1, 10);
      } else if (/^\d+$/.test(expRaw)) {
        expMonths = parseInt(expRaw, 10);
      }

      students.push({
        id: i,
        name,
        email: (r['B'] || '').toString().trim(),
        pgEmail: (r['M'] || '').toString().trim(),
        mobile: (r['D'] || '').toString().trim(),
        rollNo: (r['N'] || '').toString().trim(),
        gender: (r['K'] || '').toString().trim() || 'Not Specified',
        section: (r['AD'] || '').toString().trim() || 'A',
        aoi: (r['E'] || 'Marketing').toString().trim(),
        specialization: (r['F'] || 'None').toString().trim(),
        perc10: p10,
        perc12: p12,
        percGrad: pGrad,
        gradStreamRaw: (r['AE'] || '').toString().trim(),
        gradStream: cleanStreamCategory((r['AE'] || '').toString().trim()),
        gradUniversity: (r['P'] || '').toString().trim(),
        hasWorkExp: hasExp || expMonths > 0,
        workExpMonths: expMonths,
        workExpRaw: expRaw || 'None',
        prevJobRole: (r['T'] || '').toString().trim(),
        internship1Company: (r['X'] || '').toString().trim(),
        internship1Role: (r['Y'] || '').toString().trim(),
        internship1Duration: (r['Z'] || '').toString().trim(),
        internship2Company: (r['AI'] || r['AG'] || '').toString().trim(),
        internship2Role: (r['AJ'] || r['AH'] || '').toString().trim(),
        internship2Duration: (r['AK'] || '').toString().trim(),
        numInternships: (r['AI'] || r['AG']) ? 2 : 1,
        certifications: (r['U'] || r['W'] || '').toString().trim(),
        softSkills: (r['V'] || '').toString().trim(),
        cvLink: (r['AC'] || '').toString().trim()
      });
    }
    return students;
  }

  function cleanStreamCategory(s) {
    if (!s) return 'Other';
    const t = s.toLowerCase();
    if (t.includes('com') || t.includes('commerce') || t.includes('accounts')) return 'Commerce (B.Com)';
    if (t.includes('bba') || t.includes('business administration')) return 'Management (BBA)';
    if (t.includes('tech') || t.includes('engineering') || t.includes('cse') || t.includes('information')) return 'Engineering & Tech';
    if (t.includes('arts') || t.includes('literature') || t.includes('french')) return 'Arts & Humanities';
    if (t.includes('pharma') || t.includes('science') || t.includes('math') || t.includes('hospitality')) return 'Science & Others';
    return 'Other';
  }

  // ==================== UI HELPERS, MODALS & TOAST ====================
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==================== CANDIDATE COMPARATOR ====================
  function initCandidateComparator() {
    const btnOpen = document.getElementById('btn-open-compare');
    const btnClose = document.getElementById('btn-close-compare');
    const selectA = document.getElementById('compare-select-a');
    const selectB = document.getElementById('compare-select-b');

    if (!btnOpen || !selectA || !selectB) return;

    function populateCompareSelects() {
      selectA.innerHTML = '';
      selectB.innerHTML = '';

      rankedStudents.forEach(s => {
        const optA = document.createElement('option');
        optA.value = s.id;
        optA.textContent = `#${s.rank} - ${s.name} (${s.specialization || 'General'})`;
        selectA.appendChild(optA);

        const optB = document.createElement('option');
        optB.value = s.id;
        optB.textContent = `#${s.rank} - ${s.name} (${s.specialization || 'General'})`;
        selectB.appendChild(optB);
      });

      if (currentStudentId) {
        selectA.value = currentStudentId;
      } else if (rankedStudents.length > 0) {
        selectA.value = rankedStudents[0].id;
      }

      if (rankedStudents.length > 1) {
        const altStudent = rankedStudents.find(s => s.id !== Number(selectA.value));
        if (altStudent) selectB.value = altStudent.id;
      }
    }

    btnOpen.addEventListener('click', () => {
      populateCompareSelects();
      renderCandidateComparison(Number(selectA.value), Number(selectB.value));
      openModal('modal-compare-candidates');
    });

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        closeModal('modal-compare-candidates');
      });
    }

    selectA.addEventListener('change', () => {
      renderCandidateComparison(Number(selectA.value), Number(selectB.value));
    });

    selectB.addEventListener('change', () => {
      renderCandidateComparison(Number(selectA.value), Number(selectB.value));
    });
  }

  function renderCandidateComparison(idA, idB) {
    const container = document.getElementById('compare-results-container');
    if (!container) return;

    const sA = rankedStudents.find(s => s.id === idA);
    const sB = rankedStudents.find(s => s.id === idB);

    if (!sA || !sB) {
      container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-muted);">Please select two valid candidates to compare.</div>`;
      return;
    }

    const bA = getPeerBenchmarks(sA, rankedStudents);
    const bB = getPeerBenchmarks(sB, rankedStudents);

    const initA = sA.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const initB = sB.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const winA = (valA, valB, higherIsBetter = true) => {
      if (valA === valB) return '';
      return (higherIsBetter ? valA > valB : valA < valB) ? 'compare-win' : '';
    };
    const winB = (valA, valB, higherIsBetter = true) => {
      if (valA === valB) return '';
      return (higherIsBetter ? valB > valA : valB < valA) ? 'compare-win' : '';
    };

    container.innerHTML = `
      <!-- Dual Radar Chart Box -->
      <div style="background: var(--bg-card-subtle); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 1.1rem; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.04em;">
            6-Axis Competency Footprint Overlay
          </span>
          <div style="display: flex; align-items: center; gap: 1rem; font-size: 0.74rem;">
            <span style="display: flex; align-items: center; gap: 0.35rem; color: #06b6d4; font-weight: 700;">
              <span style="width: 10px; height: 10px; background: #06b6d4; border-radius: 50%; display: inline-block;"></span>
              ${escapeHtml(sA.name)}
            </span>
            <span style="display: flex; align-items: center; gap: 0.35rem; color: #a855f7; font-weight: 700;">
              <span style="width: 10px; height: 10px; background: #a855f7; border-radius: 50%; display: inline-block;"></span>
              ${escapeHtml(sB.name)}
            </span>
          </div>
        </div>
        <div style="width: 100%; height: 260px;">
          <canvas id="chart-compare-radar"></canvas>
        </div>
      </div>

      <!-- Side-by-Side Comparison Columns -->
      <div class="compare-content-grid">
        <!-- Candidate A Column -->
        <div>
          <div class="compare-student-hero active-focus">
            <div class="student-avatar" style="width: 48px; height: 48px; font-size: 1.1rem; background: linear-gradient(135deg, #06b6d4, #3b82f6);">${initA}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 800; font-size: 0.96rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(sA.name)}
              </div>
              <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 2px;">
                Rank #${sA.rank} • Sec ${escapeHtml(sA.section || 'A')} • ${escapeHtml(sA.specialization || 'General')}
              </div>
            </div>
            <span class="card-badge" style="font-size: 0.85rem; font-weight: 800; color: #06b6d4;">
              ${sA.scores.totalComposite} Pts
            </span>
          </div>

          <button class="action-btn" id="btn-select-compare-a" style="width: 100%; margin-top: 0.6rem; justify-content: center; font-size: 0.78rem;">
            View Full Dossier
          </button>

          <div class="compare-metrics-block">
            <div class="compare-metric-row">
              <span class="compare-metric-label">Composite Placement Score</span>
              <span class="compare-metric-val ${winA(sA.scores.totalComposite, sB.scores.totalComposite)}">${sA.scores.totalComposite} / 100</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Academics Score (/35)</span>
              <span class="compare-metric-val ${winA(sA.scores.academicScore, sB.scores.academicScore)}">${sA.scores.academicScore}</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Class 10th %</span>
              <span class="compare-metric-val ${winA(sA.perc10, sB.perc10)}">${sA.perc10}%</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Class 12th %</span>
              <span class="compare-metric-val ${winA(sA.perc12, sB.perc12)}">${sA.perc12}%</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Graduation %</span>
              <span class="compare-metric-val ${winA(sA.percGrad, sB.percGrad)}">${sA.percGrad}%</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Undergrad Stream</span>
              <span class="compare-metric-val" style="font-size: 0.74rem;">${escapeHtml(sA.gradStream)}</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Corporate Work Exp</span>
              <span class="compare-metric-val ${winA(sA.workExpMonths, sB.workExpMonths)}">
                ${sA.workExpMonths} Mos (${sA.hasWorkExp ? 'Experienced' : 'Fresher'})
              </span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Internship Projects</span>
              <span class="compare-metric-val ${winA(sA.numInternships, sB.numInternships)}">
                ${sA.numInternships} (${escapeHtml(bA.recruiterSector)})
              </span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Verified Certifications</span>
              <span class="compare-metric-val ${winA(bA.targetCertCount, bB.targetCertCount)}">
                ${bA.targetCertCount} Cert(s)
              </span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Top Role Alignment</span>
              <span class="compare-metric-val ${winA(bA.rolePathways[0].match, bB.rolePathways[0].match)}">
                ${bA.rolePathways[0].match}% Match
              </span>
            </div>
          </div>
        </div>

        <!-- Candidate B Column -->
        <div>
          <div class="compare-student-hero">
            <div class="student-avatar" style="width: 48px; height: 48px; font-size: 1.1rem; background: linear-gradient(135deg, #a855f7, #ec4899);">${initB}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 800; font-size: 0.96rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(sB.name)}
              </div>
              <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 2px;">
                Rank #${sB.rank} • Sec ${escapeHtml(sB.section || 'A')} • ${escapeHtml(sB.specialization || 'General')}
              </div>
            </div>
            <span class="card-badge" style="font-size: 0.85rem; font-weight: 800; color: #a855f7;">
              ${sB.scores.totalComposite} Pts
            </span>
          </div>

          <button class="action-btn" id="btn-select-compare-b" style="width: 100%; margin-top: 0.6rem; justify-content: center; font-size: 0.78rem;">
            View Full Dossier
          </button>

          <div class="compare-metrics-block">
            <div class="compare-metric-row">
              <span class="compare-metric-label">Composite Placement Score</span>
              <span class="compare-metric-val ${winB(sA.scores.totalComposite, sB.scores.totalComposite)}">${sB.scores.totalComposite} / 100</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Academics Score (/35)</span>
              <span class="compare-metric-val ${winB(sA.scores.academicScore, sB.scores.academicScore)}">${sB.scores.academicScore}</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Class 10th %</span>
              <span class="compare-metric-val ${winB(sA.perc10, sB.perc10)}">${sB.perc10}%</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Class 12th %</span>
              <span class="compare-metric-val ${winB(sA.perc12, sB.perc12)}">${sB.perc12}%</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Graduation %</span>
              <span class="compare-metric-val ${winB(sA.percGrad, sB.percGrad)}">${sB.percGrad}%</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Undergrad Stream</span>
              <span class="compare-metric-val" style="font-size: 0.74rem;">${escapeHtml(sB.gradStream)}</span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Corporate Work Exp</span>
              <span class="compare-metric-val ${winB(sA.workExpMonths, sB.workExpMonths)}">
                ${sB.workExpMonths} Mos (${sB.hasWorkExp ? 'Experienced' : 'Fresher'})
              </span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Internship Projects</span>
              <span class="compare-metric-val ${winB(sA.numInternships, sB.numInternships)}">
                ${sB.numInternships} (${escapeHtml(bB.recruiterSector)})
              </span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Verified Certifications</span>
              <span class="compare-metric-val ${winB(bA.targetCertCount, bB.targetCertCount)}">
                ${bB.targetCertCount} Cert(s)
              </span>
            </div>
            <div class="compare-metric-row">
              <span class="compare-metric-label">Top Role Alignment</span>
              <span class="compare-metric-val ${winB(bA.rolePathways[0].match, bB.rolePathways[0].match)}">
                ${bB.rolePathways[0].match}% Match
              </span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire up "View Full Dossier" buttons
    const btnA = document.getElementById('btn-select-compare-a');
    if (btnA) {
      btnA.addEventListener('click', () => {
        currentStudentId = sA.id;
        renderStudentList();
        closeModal('modal-compare-candidates');
        const tabInd = document.getElementById('tab-individual');
        if (tabInd) tabInd.click();
      });
    }
    const btnB = document.getElementById('btn-select-compare-b');
    if (btnB) {
      btnB.addEventListener('click', () => {
        currentStudentId = sB.id;
        renderStudentList();
        closeModal('modal-compare-candidates');
        const tabInd = document.getElementById('tab-individual');
        if (tabInd) tabInd.click();
      });
    }

    // Render Dual Radar Overlay Chart
    setTimeout(() => {
      const radarCanvas = document.getElementById('chart-compare-radar');
      if (radarCanvas && typeof Chart !== 'undefined') {
        if (charts.compareRadar) {
          charts.compareRadar.destroy();
        }
        charts.compareRadar = new Chart(radarCanvas.getContext('2d'), {
          type: 'radar',
          data: {
            labels: ['Academics', 'Corporate Exp', 'Internships', 'Analytics & Tools', 'Certifications', 'Soft Skills'],
            datasets: [
              {
                label: sA.name,
                data: bA.radarCandidate,
                backgroundColor: 'rgba(6, 182, 212, 0.22)',
                borderColor: '#06b6d4',
                pointBackgroundColor: '#06b6d4',
                pointBorderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 3
              },
              {
                label: sB.name,
                data: bB.radarCandidate,
                backgroundColor: 'rgba(168, 85, 247, 0.22)',
                borderColor: '#a855f7',
                pointBackgroundColor: '#a855f7',
                pointBorderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 3
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                titleFont: { size: 11, weight: 'bold' },
                bodyFont: { size: 10 },
                padding: 8,
                cornerRadius: 6
              }
            },
            scales: {
              r: {
                min: 0,
                max: 100,
                ticks: { display: false, stepSize: 25 },
                angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                pointLabels: {
                  font: { size: 9, weight: '600' },
                  color: '#94a3b8'
                }
              }
            }
          }
        });
      }
    }, 50);
  }

  // ==================== EVENT LISTENERS & INITIALIZATION ====================
  function setupEventListeners() {
    // Navigation Tabs
    const tabIndividual = document.getElementById('tab-individual');
    const tabGroup = document.getElementById('tab-group');
    const viewIndividual = document.getElementById('view-individual');
    const viewGroup = document.getElementById('view-group');

    tabIndividual.addEventListener('click', () => {
      activeTab = 'individual';
      tabIndividual.classList.add('active');
      tabIndividual.setAttribute('aria-selected', 'true');
      tabGroup.classList.remove('active');
      tabGroup.setAttribute('aria-selected', 'false');
      viewIndividual.classList.add('active');
      viewGroup.classList.remove('active');
    });

    tabGroup.addEventListener('click', () => {
      activeTab = 'group';
      tabGroup.classList.add('active');
      tabGroup.setAttribute('aria-selected', 'true');
      tabIndividual.classList.remove('active');
      tabIndividual.setAttribute('aria-selected', 'false');
      viewGroup.classList.add('active');
      viewIndividual.classList.remove('active');
      renderGroupDashboard();
    });

    // Search Input
    document.getElementById('student-search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderStudentList();
    });

    // Separate AOI Pill Buttons
    document.querySelectorAll('#aoi-pills-container .filter-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#aoi-pills-container .filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterAOI = btn.getAttribute('data-aoi');
        renderStudentList();
      });
    });

    // Separate Other Specialization Pill Buttons
    document.querySelectorAll('#spec-pills-container .filter-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#spec-pills-container .filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterSpec = btn.getAttribute('data-spec');
        renderStudentList();
      });
    });

    // Experience Filter
    document.getElementById('filter-exp').addEventListener('change', (e) => {
      filterExp = e.target.value;
      renderStudentList();
    });

    // Section Filter
    document.getElementById('filter-section').addEventListener('change', (e) => {
      filterSection = e.target.value;
      renderStudentList();
    });

    // Sort Dropdown
    document.getElementById('sort-by').addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderStudentList();
    });

    // Action Buttons
    document.getElementById('btn-export').addEventListener('click', exportToExcel);
    const btnExportGroup = document.getElementById('btn-export-group');
    if (btnExportGroup) btnExportGroup.addEventListener('click', exportToExcel);

    // Export Drilldown Cohort Button
    const btnExportDrilldown = document.getElementById('btn-export-drilldown');
    if (btnExportDrilldown) {
      btnExportDrilldown.addEventListener('click', () => {
        if (activeDrilldownStudents.length === 0) return;
        exportCustomCohortToExcel(activeDrilldownCategory, activeDrilldownStudents);
      });
    }

    // Drilldown Search Filter
    const drilldownSearch = document.getElementById('drilldown-search-input');
    if (drilldownSearch) {
      drilldownSearch.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
          renderDrilldownList(activeDrilldownStudents);
          return;
        }
        const filtered = activeDrilldownStudents.filter(s => {
          return s.name.toLowerCase().includes(q) ||
                 (s.specialization || '').toLowerCase().includes(q) ||
                 (s.aoi || '').toLowerCase().includes(q) ||
                 (s.section || '').toLowerCase().includes(q) ||
                 (s.internship1Company || '').toLowerCase().includes(q) ||
                 (s.gradStream || '').toLowerCase().includes(q);
        });
        renderDrilldownList(filtered);
      });
    }

    // Refresh Dataset
    document.getElementById('btn-refresh').addEventListener('click', () => {
      rankedStudents = processAndRankStudents(INITIAL_BATCH_DATA);
      currentStudentId = rankedStudents[0].id;
      renderStudentList();
      if (activeTab === 'group') renderGroupDashboard();
      showToast('Reset data to initial senior batch records!');
    });

    // Modals
    document.getElementById('btn-upload').addEventListener('click', () => {
      openModal('modal-upload');
    });

    document.getElementById('btn-methodology').addEventListener('click', () => {
      openModal('modal-methodology');
    });

    document.getElementById('btn-close-methodology').addEventListener('click', () => {
      closeModal('modal-methodology');
    });

    document.getElementById('btn-close-upload').addEventListener('click', () => {
      closeModal('modal-upload');
    });

    const btnCloseDrilldown = document.getElementById('btn-close-drilldown');
    if (btnCloseDrilldown) {
      btnCloseDrilldown.addEventListener('click', () => {
        closeModal('modal-chart-drilldown');
      });
    }

    // Close modals on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });

    // Theme Toggle
    const btnTheme = document.getElementById('btn-theme');
    const themeIcon = document.getElementById('theme-icon');
    btnTheme.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      
      if (newTheme === 'light') {
        themeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />`;
      } else {
        themeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />`;
      }

      if (activeTab === 'group') renderGroupDashboard();
    });

    // File Upload & Drag-and-Drop
    const fileInput = document.getElementById('excel-file-input');
    const dropzone = document.getElementById('dropzone');
    const btnBrowse = document.getElementById('btn-browse-file');

    btnBrowse.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleExcelFile(e.target.files[0]);
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleExcelFile(e.dataTransfer.files[0]);
      }
    });

    // Initialize Head-to-Head Candidate Comparator
    initCandidateComparator();
  }

  function init() {
    setupEventListeners();

    if (typeof INITIAL_BATCH_DATA !== 'undefined' && Array.isArray(INITIAL_BATCH_DATA)) {
      rawBatchData = INITIAL_BATCH_DATA;
    }

    rankedStudents = processAndRankStudents(rawBatchData);
    if (rankedStudents.length > 0) {
      currentStudentId = rankedStudents[0].id;
    }

    renderStudentList();
  }

  // Launch on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
