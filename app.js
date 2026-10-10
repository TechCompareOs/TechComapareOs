// === SUPABASE INITIALIZATION ===
const SUPABASE_URL = "https://hizmjehkwbgmrlxezvcl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NvyZ8UYqTfZ5kQOhI87z0w_tOBpX9Ha";

let supabaseClient = null;
// Initialize Supabase Client safely
if (window.supabase && typeof window.supabase.createClient  === 'function') {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let localListings = [
  { id: 1, name: 'Lenovo IdeaPad Slim 3', category: 'Laptop', brand: 'Lenovo', price: 4200, retail_price: 6999, seller_id: '218002931', rating: 4.8 },
  { id: 2, name: 'Samsung Galaxy A24 128GB', category: 'Phone', brand: 'Samsung', price: 2100, retail_price: 3499, seller_id: '219084112', rating: 4.2 },
  { id: 3, name: 'Apple iPhone 15 128GB', category: 'Phone', brand: 'Apple', price: 11500, retail_price: 15999, seller_id: '220048129', rating: 5.0 },
  { id: 4, name: 'HP 15 Intel Core i3', category: 'Laptop', brand: 'HP', price: 3800, retail_price: 5800, seller_id: '217039201', rating: 4.0 }
];

let currentUser = null;
let isSignUpMode = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderListings(items) {
  const container = document.getElementById('marketplace-container');
  const countEl = document.getElementById('activeListingsCount');

  if (countEl) countEl.textContent = `${(items || []).length} verified devices listed`;
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:2rem; color:#6c757d;">No listings found matching your search.</p>';
    return;
  }

  container.innerHTML = items.map(item => {
    const savings = Math.max(0, (item.retail_price || item.price) - item.price);
    const retailValue = item.retail_price || item.price;
    const percentOff = retailValue ? Math.round((savings / retailValue) * 100) : 0;

    return `
      <div class="listing-card">
        <div class="card-header">
          <span class="card-tag">${escapeHtml(item.category)}</span>
          ${savings > 0 ? `<span class="savings-badge">Save R${savings.toLocaleString()} (${percentOff}% off)</span>` : ''}
        </div>
        <h3>${escapeHtml(item.name)}</h3>
        <p><strong>Brand:</strong> ${escapeHtml(item.brand)}</p>
        <p class="price">
          R ${Number(item.price || 0).toLocaleString()}
          <span class="retail">R ${Number(retailValue || 0).toLocaleString()}</span>
        </p>
        <p class="seller">Seller ID: ${escapeHtml(item.seller_id)} | ★ ${Number(item.rating) || 0}</p>
        <button class="btn-primary" data-seller="${escapeHtml(item.seller_id)}" data-device="${escapeHtml(item.name)}">Contact Seller</button>
      </div>
    `;
  }).join('');
}

function filterListings() {
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const sortFilter = document.getElementById('sortFilter');

  if (!searchInput || !categoryFilter) return;

  const query = searchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const sort = sortFilter ? sortFilter.value : 'featured';

  let filtered = localListings.filter(item => {
    const name = (item.name || '').toLowerCase();
    const brand = (item.brand || '').toLowerCase();
    const matchesSearch = !query || name.includes(query) || brand.includes(query);
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (sort === 'low') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'high') filtered.sort((a, b) => b.price - a.price);

  renderListings(filtered);
}

function switchTab(tabId) {
  const section = document.getElementById(tabId);
  if (!section) return;

  if (tabId !== 'home' && !currentUser) {
    alert('Access Denied: Please sign in with your TUT student email (@tut4life.ac.za) to access this section.');
    openAuthModal();
    return;
  }

  document.querySelectorAll('.tab-section').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(button => button.classList.remove('active'));

  section.classList.add('active');
  const navBtn = document.getElementById(`nav-${tabId}`);
  if (navBtn) navBtn.classList.add('active');
}

function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'flex';
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
}

function toggleAuthMode(event) {
  if (event) event.preventDefault();
  isSignUpMode = !isSignUpMode;

  const modalTitle = document.getElementById('modalTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleText = document.getElementById('toggleText');
  const toggleBtn = document.getElementById('toggleBtn');

  if (isSignUpMode) {
    if (modalTitle) modalTitle.innerText = 'Create Student Account';
    if (submitBtn) submitBtn.innerText = 'Sign Up with Magic Link';
    if (toggleText) toggleText.innerText = 'Already have an account?';
    if (toggleBtn) toggleBtn.innerText = 'Log in here';
  } else {
    if (modalTitle) modalTitle.innerText = 'Student Sign In';
    if (submitBtn) submitBtn.innerText = 'Sign In with Magic Link';
    if (toggleText) toggleText.innerText = "Don't have an account?";
    if (toggleBtn) toggleBtn.innerText = 'Register here';
  }
}

// --- Function to handle Magic Link Authentication ---
async function handleAuth(event) {
  if (event) event.preventDefault();

  const emailInput = document.getElementById('authEmail');
  const submitBtn = document.getElementById('authSubmitBtn');
  const email = emailInput?.value.trim();

  if (!email) {
    alert('Please enter your TUT student email address.');
    return;
  }

  const lowerEmail = email.toLowerCase();
  if (!lowerEmail.endsWith('@tut4life.ac.za') && !lowerEmail.endsWith('@tut.ac.za')) {
    alert('Access restricted: Please enter a valid TUT email address (@tut4life.ac.za).');
    return;
  }

  if (!submitBtn) return;
  const originalText = submitBtn.innerText;
  submitBtn.innerText = 'Sending Magic Link...';
  submitBtn.disabled = true;

  try {
    // Direct check on supabaseClient
    if (!supabaseClient || !supabaseClient.auth) {
      throw new Error("Supabase client is not initialized. Check your CDN script tags.");
    }

    // Request Magic Link from Supabase
    const { error } = await supabaseClient.auth.signInWithOtp({ 
      email: email,
      options: {
        emailRedirectTo: window.location.href
      }
    });
    
    if (error) throw error;
    
    alert('Magic link sent! Please check your TUT email inbox and click the link to log in.');
    closeAuthModal();

  } catch (err) {
    alert('Authentication Error: ' + err.message);
  } finally {
    submitBtn.innerText = originalText;
    submitBtn.disabled = false;
  }
}


function updateAuthUI(user) {
  const container = document.getElementById('authStatus');
  const notice = document.getElementById('loggedOutNotice');

  if (notice) notice.style.display = user ? 'none' : 'flex';
  if (!container) return;

  if (user) {
    const studentNum = (user.email || 'Student').split('@')[0];
    container.innerHTML = `
      <span class="user-badge">👤 ${studentNum}</span>
      <button class="btn-primary" onclick="logoutUser()">Log Out</button>
    `;
  } else {
    container.innerHTML = `
      <button class="btn-primary" onclick="openAuthModal()">Sign In</button>
    `;
  }
}
function openAuthModal(signUp = false)
{
  isSignUpMode = signUp;
  
  const modal = document.getElementById('authModal');
  const modalTitle = document.getElementById('modalTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleText = document.getElementById('toggleText');
  const toggleBtn = document.getElementById('toggleBtn');

 if (modal) modal.style.display = 'flex';

  if (isSignUpMode) {
    if (modalTitle) modalTitle.innerText = 'Create Student Account';
    if (submitBtn) submitBtn.innerText = 'Sign Up with Magic Link';
    if (toggleText) toggleText.innerText = 'Already have an account?';
    if (toggleBtn) toggleBtn.innerText = 'Log in here';
  } else {
    if (modalTitle) modalTitle.innerText = 'Student Sign In';
    if (submitBtn) submitBtn.innerText = 'Sign In with Magic Link';
    if (toggleText) toggleText.innerText = "Don't have an account?";
    if (toggleBtn) toggleBtn.innerText = 'Register here';
  }
}
async function logoutUser() {
  if (supabaseClient && supabaseClient.auth) {
    await supabaseClient.auth.signOut();
  }
  currentUser = null;
  updateAuthUI(null);
  switchTab('home');
  alert('You have logged out.');
}

function contactSeller(sellerId, deviceName) {
  alert(`Connecting to seller (${sellerId}) regarding device: ${deviceName}`);
}

function runTradeInCalc() {
  const price = Number(document.getElementById('tradePrice').value);
  const age = Number(document.getElementById('tradeAge').value);
  const condition = Number(document.getElementById('tradeCondition').value);
  const result = document.getElementById('tradeResult');

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(age) || age < 0) {
    alert('Please enter a valid price and age.');
    return;
  }

  const baseValue = Math.max(price * 0.15, price * (1 - age * 0.01));
  const estimatedCredit = (baseValue * condition).toFixed(2);

  result.innerHTML = `<strong>Estimated Trade-In Credit: R${estimatedCredit}</strong>`;
  result.hidden = false;
}

function runAdvisorMatch() {
  const budget = Number(document.getElementById('advisorBudget').value);
  const program = document.getElementById('advisorProgram').value;
  const result = document.getElementById('advisorResult');

  if (!Number.isFinite(budget) || budget <= 0) {
    alert('Please enter a valid budget amount.');
    return;
  }

  let rec;
  if (program === 'cs') {
    rec = budget >= 6000 ? 'Core i5 / Ryzen 5 processor, 16 GB RAM, and SSD for IDEs & programming.' : 'Core i5-class processor with 8 GB RAM (upgradable).';
  } else if (program === 'it') {
    rec = budget >= 4500 ? 'Core i5 processor with 8 GB RAM and SSD.' : 'Refurbished laptop with at least 8 GB RAM.';
  } else {
    rec = 'Reliable entry-level notebook or tablet for reading and coursework.';
  }

  result.textContent = rec;
  result.hidden = false;
}

function createNewListing() {
  if (!currentUser) {
    openAuthModal();
    return;
  }

  const name = document.getElementById('sellTitle').value.trim();
  const category = document.getElementById('sellCategory').value;
  const brand = document.getElementById('sellBrand').value.trim();
  const price = Number(document.getElementById('sellPrice').value);

  if (!name || !brand || !Number.isFinite(price) || price <= 0) {
    alert('Please complete all fields with a valid asking price.');
    return;
  }

  localListings.unshift({
    id: Date.now(),
    name,
    category,
    brand,
    price,
    retail_price: Math.round(price * 1.3),
    seller_id: (currentUser.email || 'Student').split('@')[0],
    rating: 5.0
  });

  document.getElementById('sellTitle').value = '';
  document.getElementById('sellBrand').value = '';
  document.getElementById('sellPrice').value = '';

  filterListings();
  switchTab('marketplace');
  alert('Device listing published successfully!');
}
// === HANDLE MAGIC LINK REDEEM & SESSION ON LOAD ===
async function checkAuthSession() {
  if (!supabaseClient) return;
  
  // Check if user returned from clicking the email magic link
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  
  if (session && session.user) {
    currentUser = session.user;
    updateAuthUI(currentUser);
    console.log("Logged in user:", currentUser.email);
  }

  // Listen for real-time authentication state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      updateAuthUI(currentUser);
      alert('✨ Successfully signed in as ' + currentUser.email);
      
      // Close modal and take them to the marketplace
      const modal = document.getElementById('authModal');
      if (modal) modal.style.display = 'none';
      if (typeof switchTab === 'function') switchTab('marketplace');
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      updateAuthUI(null);
    }
  });
}

// Run the check when the page loads
window.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
});

function handleBotQuery(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('botInput');
  const logs = document.getElementById('botChatLogs');
  const msg = input.value.trim();
  if (!msg) return;

  logs.innerHTML += `<div class="bot-msg user">${escapeHtml(msg)}</div>`;
  input.value = '';

  const q = msg.toLowerCase();
  let answer = 'Ask me about finding a device, selling on campus, or specs for your course.';
  if (q.includes('sell')) answer = 'Sign in, go to the Sell tab, and complete the device details to publish.';
  else if (q.includes('buy') || q.includes('laptop') || q.includes('phone')) answer = 'Open Marketplace to view available devices listed by students.';
  else if (q.includes('hi') || q.includes('hello')) answer = 'Hello! How can I help you on campus today?';

  logs.innerHTML += `<div class="bot-msg bot">${answer}</div>`;
  logs.scrollTop = logs.scrollHeight;
}

function toggleBot() {
  const content = document.getElementById('botContent');
  if (content) content.hidden = !content.hidden;
}

document.addEventListener('click', event => {
  const button = event.target.closest('#marketplace-container button[data-seller]');
  if (button) contactSeller(button.dataset.seller, button.dataset.device);
});

window.addEventListener('DOMContentLoaded', async () => {
  renderListings(localListings);

  if (supabaseClient && supabaseClient.auth) {
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data?.session) {
        currentUser = data.session.user;
        updateAuthUI(currentUser);
      }
    } catch (error) {
      console.warn('Supabase session check failed:', error);
    }
  }
});