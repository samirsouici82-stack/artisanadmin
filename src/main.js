import jsPDF from 'jspdf';
import {
  inscrireArtisan,
  connecterArtisan,
  envoyerLienMagique,
  deconnecter,
  recupererSession,
  ecouterAuth,
  chargerContexteHebdomadaire,
  ajouterAssurance,
  ajouterCertifications,
  getReglesCertifications,
  enregistrerAttestationGeneree
} from './lib/supabase-client.js';

// Ces libellés/icônes sont purement d'affichage — toute la logique métier
// (durées de validité, réglementation, aides) vient de la base Supabase.
const METIERS_UI = {
  plombier: { label: 'Plombier', icon: '🔧' },
  electricien: { label: 'Électricien', icon: '⚡' },
  macon: { label: 'Maçon', icon: '🧱' },
  chauffagiste: { label: 'Chauffagiste', icon: '🔥' }
};
const TYPE_ASSURANCE_LABEL = {
  decennale: 'Décennale',
  rc_pro: 'RC Professionnelle',
  vehicule: 'Véhicule'
};

let contexteActuel = null;
let onboardingContext = null;

/* ---------------------------------------------------------------- */
/* Utilitaires date                                                  */
/* ---------------------------------------------------------------- */
function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d - now) / 86400000);
}
function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}
function fmtDue(days) {
  if (days < 0) return 'en retard';
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days <= 7) return `sous ${days} j`;
  if (days <= 31) return `dans ${days} j`;
  return `dans ${Math.round(days / 7)} sem.`;
}

/* ---------------------------------------------------------------- */
/* Moteur de règles — construit le bon de travail à partir du        */
/* contexte chargé depuis Supabase (chargerContexteHebdomadaire)     */
/* ---------------------------------------------------------------- */
function buildWeeklyTasks(ctx) {
  const tasks = [];

  // URSSAF — échéance mensuelle le 20
  const now = new Date();
  let dueUrssaf = new Date(now.getFullYear(), now.getMonth(), 20);
  if (now.getDate() > 20) dueUrssaf = new Date(now.getFullYear(), now.getMonth() + 1, 20);
  const dUrssaf = Math.ceil((dueUrssaf - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  tasks.push({
    cat: 'URS',
    urgent: dUrssaf <= 3,
    label: 'Déclarer et payer les cotisations URSSAF du mois',
    detail: "Base : chiffre d'affaires déclaré le mois dernier.",
    days: dUrssaf,
    due: fmtDue(dUrssaf)
  });

  // Assurances
  ctx.assurances.forEach((a) => {
    const d = daysUntil(a.date_expiration);
    if (d <= 60) {
      const label = TYPE_ASSURANCE_LABEL[a.type] || a.type;
      tasks.push({
        cat: 'ASS',
        urgent: d <= 14,
        label: `Renouveler l'attestation ${label.toLowerCase()}`,
        detail: `Contrat en cours expirant le ${fmtDate(a.date_expiration)}.`,
        days: d,
        due: fmtDue(d)
      });
    }
  });

  // Certifications / habilitations
  ctx.certifications.forEach((c) => {
    const expiry = new Date(c.date_obtention + 'T00:00:00');
    expiry.setFullYear(expiry.getFullYear() + c.duree_ans);
    const d = Math.ceil((expiry - new Date()) / 86400000);
    if (d <= 90) {
      tasks.push({
        cat: 'REN',
        urgent: d <= 21,
        label: `Préparer le renouvellement ${c.code}`,
        detail: `Certification obtenue le ${fmtDate(c.date_obtention)}, valable ${c.duree_ans} ans.`,
        days: d,
        due: fmtDue(d)
      });
    }
  });

  // Facturation
  if (ctx.facturesEnAttente > 0) {
    tasks.push({
      cat: 'FAC',
      urgent: false,
      label: `${ctx.facturesEnAttente} facture${ctx.facturesEnAttente > 1 ? 's' : ''} en attente d'envoi`,
      detail: 'Brouillons déjà préparés à partir de vos chantiers en cours.',
      days: 5,
      due: 'cette semaine'
    });
  }

  // Aides
  if (ctx.chantiers.length > 0 && ctx.aides.length > 0) {
    tasks.push({
      cat: 'AID',
      urgent: false,
      label: `Vérifier l'éligibilité ${ctx.aides[0].label}`,
      detail: `Concerne un chantier en cours (${ctx.chantiers.length} actif${ctx.chantiers.length > 1 ? 's' : ''}).`,
      days: 10,
      due: 'à vérifier'
    });
  }

  // Réglementation
  if (ctx.reglementation) {
    tasks.push({
      cat: 'REG',
      urgent: false,
      label: 'Nouveauté réglementaire à connaître',
      detail: ctx.reglementation.texte,
      days: 30,
      due: 'information'
    });
  }

  tasks.sort((a, b) => b.urgent - a.urgent || a.days - b.days);
  return tasks;
}

function computeCategories(ctx, tasks) {
  const urgentCount = tasks.filter((t) => t.urgent).length;
  const urssafUrgent = tasks.find((t) => t.cat === 'URS')?.urgent ?? false;
  return [
    { code: 'OBL', name: 'Obligations', count: 'à jour', warn: false },
    { code: 'FAC', name: 'Facturation', count: `${ctx.facturesEnAttente} en attente`, warn: ctx.facturesEnAttente > 0 },
    { code: 'URS', name: 'URSSAF', count: urssafUrgent ? 'à faire' : 'à jour', warn: urssafUrgent },
    { code: 'ASS', name: 'Assurances', count: `${ctx.assurances.length} contrat(s)`, warn: false },
    { code: 'ATT', name: 'Attestations', count: '2 disponibles', warn: false },
    { code: 'REN', name: 'Renouvellements', count: `${tasks.filter((t) => t.cat === 'REN').length} en cours`, warn: tasks.some((t) => t.cat === 'REN' && t.urgent) },
    { code: 'DOC', name: 'Documents', count: 'coffre-fort actif', warn: false },
    { code: 'ECH', name: 'Échéances', count: `${tasks.length} cette semaine`, warn: urgentCount > 0 },
    { code: 'AID', name: 'Aides', count: `${ctx.aides.length} éligibles`, warn: false },
    { code: 'REG', name: 'Réglementation', count: ctx.reglementation ? '1 mise à jour' : 'à jour', warn: false }
  ];
}

/* ---------------------------------------------------------------- */
/* Navigation entre les grandes vues (vitrine / login / onboarding /  */
/* dashboard) — une seule visible à la fois.                         */
/* ---------------------------------------------------------------- */
function hideAllViews() {
  $('landingView').style.display = 'none';
  $('loginView').style.display = 'none';
  $('onboardingView').style.display = 'none';
  $('dashView').style.display = 'none';
  $('publicNav').style.display = 'none';
  $('whoami').style.display = 'none';
}

function showLanding() {
  hideAllViews();
  $('landingView').style.display = 'block';
  $('publicNav').style.display = 'flex';
}

function showLogin(tab = 'login') {
  hideAllViews();
  $('loginView').style.display = 'block';
  switchTab(tab);
}

/* ---------------------------------------------------------------- */
/* Rendu — LOGIN / SIGNUP                                            */
/* ---------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

function switchTab(tab) {
  $('tabLogin').classList.toggle('active', tab === 'login');
  $('tabSignup').classList.toggle('active', tab === 'signup');
  $('loginForm').classList.toggle('open', tab === 'login');
  $('signupForm').classList.toggle('open', tab === 'signup');
  hideMessage();
}

function showMessage(type, text) {
  const el = $('authMessage');
  el.className = `auth-message ${type}`;
  el.textContent = text;
}
function hideMessage() {
  $('authMessage').className = 'auth-message';
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    const { session } = await connecterArtisan(email, password);
    hideMessage();
    await afterAuth(session.user.id);
  } catch (err) {
    showMessage('error', traduireErreur(err));
  }
}

async function handleMagicLink() {
  const email = $('loginEmail').value.trim();
  if (!email) {
    showMessage('error', "Renseignez d'abord votre email ci-dessus.");
    return;
  }
  try {
    await envoyerLienMagique(email);
    showMessage('success', `Un lien de connexion a été envoyé à ${email}.`);
  } catch (err) {
    showMessage('error', traduireErreur(err));
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const nom = $('su_nom').value.trim();
  const entreprise = $('su_entreprise').value.trim();
  const metier = $('su_metier').value;
  const email = $('su_email').value.trim();
  const password = $('su_password').value;

  try {
    const data = await inscrireArtisan({ email, password, nom, entreprise, metier });

    if (!data.session) {
      // Confirmation par email requise : les données initiales (assurance,
      // certifications) seront complétées via l'écran d'onboarding affiché
      // automatiquement au premier login (voir afterAuth / showOnboarding).
      showMessage('success', 'Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.');
      switchTab('login');
      return;
    }

    hideMessage();
    await afterAuth(data.user.id);
  } catch (err) {
    showMessage('error', traduireErreur(err));
  }
}

async function handleLogout() {
  await deconnecter();
  contexteActuel = null;
  onboardingContext = null;
  showLanding();
}

function traduireErreur(err) {
  const msg = err?.message || '';
  if (msg.includes('Invalid login credentials')) return 'Email ou mot de passe incorrect.';
  if (msg.includes('User already registered')) return 'Un compte existe déjà avec cet email.';
  return msg || "Une erreur est survenue, réessayez.";
}

/* ---------------------------------------------------------------- */
/* Rendu — DASHBOARD                                                  */
/* ---------------------------------------------------------------- */
/**
 * Point d'entrée après toute connexion réussie (login, magic link, ou
 * inscription immédiatement authentifiée). Décide si l'artisan doit
 * d'abord compléter son profil ou s'il peut aller directement au dashboard.
 */
async function afterAuth(artisanId) {
  const ctx = await chargerContexteHebdomadaire(artisanId);
  if (ctx.assurances.length === 0) {
    showOnboarding(ctx);
  } else {
    renderDashboard(ctx);
  }
}

function showOnboarding(ctx) {
  onboardingContext = ctx;
  hideAllViews();
  $('onboardingView').style.display = 'block';
  $('whoami').style.display = 'flex';
  $('whoName').textContent = ctx.profil.nom;
  $('whoMetier').textContent = `${METIERS_UI[ctx.profil.metier].label} — ${ctx.profil.entreprise}`;
}

async function handleOnboarding(e) {
  e.preventDefault();
  const artisanId = onboardingContext.profil.id;
  const metier = onboardingContext.profil.metier;
  const dateExpiration = $('ob_assurance').value;
  const compagnie = $('ob_compagnie').value.trim();

  try {
    await ajouterAssurance(artisanId, { type: 'decennale', compagnie, date_expiration: dateExpiration });

    const regles = await getReglesCertifications(metier);
    if (regles.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      await ajouterCertifications(
        artisanId,
        regles.map((r) => ({ code: r.label, date_obtention: today, duree_ans: r.duree_ans }))
      );
    }

    $('onboardingMessage').className = 'auth-message';
    $('onboardingView').style.display = 'none';
    const ctx = await chargerContexteHebdomadaire(artisanId);
    renderDashboard(ctx);
  } catch (err) {
    $('onboardingMessage').className = 'auth-message error';
    $('onboardingMessage').textContent = traduireErreur(err);
  }
}

function renderDashboard(ctx) {
  contexteActuel = ctx;
  const cfg = METIERS_UI[ctx.profil.metier];

  hideAllViews();
  $('dashView').style.display = 'block';
  $('whoami').style.display = 'flex';
  $('whoName').textContent = ctx.profil.nom;
  $('whoMetier').textContent = `${cfg.label} — ${ctx.profil.entreprise}`;

  const tasks = buildWeeklyTasks(ctx);
  const urgentCount = tasks.filter((t) => t.urgent).length;

  $('dashDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('ticketRef').textContent = `RÉF. ${ctx.profil.id.slice(0, 8).toUpperCase()} — ${ctx.profil.entreprise}`;

  const stamp = $('stamp');
  if (urgentCount > 0) {
    stamp.className = 'stamp';
    stamp.innerHTML = `${urgentCount} URGENT${urgentCount > 1 ? 'S' : ''}<br>CETTE<br>SEMAINE`;
  } else {
    stamp.className = 'stamp calm';
    stamp.innerHTML = `RIEN<br>D'URGENT<br>🎉`;
  }

  $('taskList').innerHTML = tasks
    .map(
      (t) => `
    <label class="task">
      <input type="checkbox">
      <div class="task-body">
        <div class="task-top">
          <span class="task-cat ${t.urgent ? 'tag-urgent' : ''}">${t.cat}</span>
          <span class="task-label">${t.label}</span>
        </div>
        <div class="task-detail">${t.detail}</div>
      </div>
      <div class="task-due">${t.due}</div>
    </label>`
    )
    .join('');
  updateProgress();

  const cats = computeCategories(ctx, tasks);
  $('catGrid').innerHTML = cats
    .map(
      (c, i) => `
    <div class="cat-card">
      <div class="cat-code">${c.code} — ${String(i + 1).padStart(2, '0')}</div>
      <div class="cat-name">${c.name}</div>
      <div class="cat-count ${c.warn ? 'warn' : ''}"><span class="dot"></span>${c.count}</div>
    </div>`
    )
    .join('');

  renderDocs(ctx);
}

function updateProgress() {
  const boxes = document.querySelectorAll('#taskList input[type="checkbox"]');
  const labels = document.querySelectorAll('#taskList .task');
  let done = 0;
  boxes.forEach((b, i) => {
    if (b.checked) {
      done++;
      labels[i].classList.add('done');
    } else {
      labels[i].classList.remove('done');
    }
  });
  const pct = boxes.length ? Math.round((done / boxes.length) * 100) : 0;
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = `${done} sur ${boxes.length} traitée${done > 1 ? 's' : ''}`;
}

/* ---------------------------------------------------------------- */
/* Documents & attestations (génération PDF + traçabilité Supabase)  */
/* ---------------------------------------------------------------- */
function renderDocs(ctx) {
  const cfg = METIERS_UI[ctx.profil.metier];
  const assuranceLabel = TYPE_ASSURANCE_LABEL[ctx.assurances[0]?.type] || 'Assurance';
  const docs = [
    { id: 'decennale', icon: '📄', name: `Attestation ${assuranceLabel.toLowerCase()}`, desc: "À fournir à un client avant le début d'un chantier." },
    { id: 'vigilance', icon: '🖋️', name: 'Attestation de vigilance URSSAF', desc: 'Justifie que vos cotisations sociales sont à jour.' }
  ];
  $('docGrid').innerHTML = docs
    .map(
      (d) => `
    <div class="doc-card">
      <div class="doc-icon">${d.icon}</div>
      <div class="doc-name">${d.name}</div>
      <div class="doc-desc">${d.desc}</div>
      <button class="btn-pdf" data-type="${d.id}">⬇ Générer le PDF</button>
      <div class="doc-status" id="status-${d.id}">Généré, téléchargé et archivé ✓</div>
    </div>`
    )
    .join('');
  // évite le doublon de cfg non utilisé
  void cfg;
}

async function genererPDF(type) {
  const ctx = contexteActuel;
  const profil = ctx.profil;
  const doc = new jsPDF();
  const bleu = [30, 58, 92],
    orange = [217, 83, 30],
    ardoise = [42, 46, 51],
    grey = [91, 97, 104];

  doc.setFillColor(...bleu);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ArtisanAdmin', 16, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Document généré automatiquement', 16, 21.5);

  let title, lines;
  if (type === 'decennale') {
    const a = ctx.assurances[0];
    title = `ATTESTATION D'ASSURANCE — ${(TYPE_ASSURANCE_LABEL[a?.type] || 'DÉCENNALE').toUpperCase()}`;
    lines = [
      ['Entreprise', profil.entreprise],
      ['Artisan', profil.nom],
      ['Métier', METIERS_UI[profil.metier].label],
      ['Validité jusqu\'au', a ? fmtDate(a.date_expiration) : 'Non renseigné'],
      ['Statut', a && daysUntil(a.date_expiration) > 0 ? 'Contrat en cours de validité' : 'Contrat à renouveler']
    ];
  } else {
    title = 'ATTESTATION DE VIGILANCE URSSAF';
    lines = [
      ['Entreprise', profil.entreprise],
      ['Artisan', profil.nom],
      ['Métier', METIERS_UI[profil.metier].label],
      ['Cotisations sociales', "Déclarées et à jour à la date d'émission"],
      ["Date d'émission", fmtDate(new Date().toISOString().slice(0, 10))]
    ];
  }

  doc.setTextColor(...ardoise);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, 16, 42, { maxWidth: 178 });

  let y = 56;
  lines.forEach(([label, val]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...grey);
    doc.text(label.toUpperCase(), 16, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...ardoise);
    doc.text(String(val), 16, y + 6);
    y += 16;
  });

  doc.setDrawColor(216, 207, 187);
  doc.setLineDashPattern([1, 1.5], 0);
  doc.line(16, y + 2, 194, y + 2);
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...grey);
  doc.text("Document généré à partir des informations renseignées par l'artisan dans ArtisanAdmin.", 16, y + 10, { maxWidth: 140 });
  doc.text('À vérifier avant tout envoi officiel à un tiers.', 16, y + 14, { maxWidth: 140 });

  const cx = 175,
    cy = y + 8,
    r = 16;
  doc.setDrawColor(...orange);
  doc.setLineWidth(1);
  doc.circle(cx, cy, r);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...orange);
  doc.text('ARTISANADMIN', cx, cy - 2, { align: 'center' });
  doc.setFontSize(6.5);
  doc.text(fmtDate(new Date().toISOString().slice(0, 10)), cx, cy + 3, { align: 'center' });

  const filename = `${type}-${profil.entreprise.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  doc.save(filename);

  try {
    await enregistrerAttestationGeneree(profil.id, type);
  } catch (err) {
    console.warn("L'attestation a bien été générée mais n'a pas pu être archivée en base :", err);
  }

  const status = $(`status-${type}`);
  status.style.display = 'block';
  showToast('PDF généré, téléchargé et archivé dans votre historique.');
}

/* ---------------------------------------------------------------- */
/* Toast                                                             */
/* ---------------------------------------------------------------- */
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------------- */
/* Câblage des événements + démarrage                                */
/* ---------------------------------------------------------------- */
function wireEvents() {
  $('tabLogin').addEventListener('click', () => switchTab('login'));
  $('tabSignup').addEventListener('click', () => switchTab('signup'));
  $('loginForm').addEventListener('submit', handleLogin);
  $('signupForm').addEventListener('submit', handleSignup);
  $('btnMagicLink').addEventListener('click', handleMagicLink);
  $('btnLogout').addEventListener('click', handleLogout);
  $('onboardingForm').addEventListener('submit', handleOnboarding);

  // Cases à cocher du bon de travail (rendues dynamiquement)
  $('taskList').addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) updateProgress();
  });

  // Boutons "Générer le PDF" (rendus dynamiquement)
  $('docGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-pdf');
    if (btn) genererPDF(btn.dataset.type);
  });

  // Vitrine : bouton "Se connecter" du header + tous les CTA "Essayer / Commencer l'essai"
  $('btnHeaderLogin').addEventListener('click', () => showLogin('login'));
  document.querySelectorAll('.btn-go-signup').forEach((btn) => {
    btn.addEventListener('click', () => showLogin('signup'));
  });

  // Démo interactive du bon de travail sur la vitrine (purement visuelle, aucune donnée réelle)
  $('lpTaskList').addEventListener('change', (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    const boxes = document.querySelectorAll('#lpTaskList input[type="checkbox"]');
    const labels = document.querySelectorAll('#lpTaskList .task');
    let done = 0;
    boxes.forEach((b, i) => {
      if (b.checked) {
        done++;
        labels[i].classList.add('done');
      } else {
        labels[i].classList.remove('done');
      }
    });
    const pct = Math.round((done / boxes.length) * 100);
    $('lpProgressFill').style.width = pct + '%';
    $('lpProgressText').textContent = `${done} sur ${boxes.length} traitée${done > 1 ? 's' : ''}`;
  });
}

async function init() {
  wireEvents();
  const session = await recupererSession();
  if (session) {
    await afterAuth(session.user.id);
  } else {
    showLanding();
  }
  // Garde l'interface synchronisée si la session expire ailleurs
  ecouterAuth((session) => {
    if (!session) showLanding();
  });
}

init();
