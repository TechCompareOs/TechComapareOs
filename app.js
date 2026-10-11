// === SUPABASE INITIALIZATION ===
const SUPABASE_URL = "https://hizmjehkwbgmrlxezvcl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NvyZ8UYqTfZ5kQOhI87z0w_tOBpX9Ha";
const IMAGE_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

let supabaseClient = null;
if (window.supabase && typeof window.supabase.createClient === 'function') {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let currentUser = null;
let isSignUpMode = false;
let allProducts = [];
let activeChatPartner = null;
let activeProductId = null;
let chatChannel = null; // single realtime subscription, created once

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

// === TABS ===
// These pages can be opened without signing in.
const PUBLIC_TABS = ['home', 'about', 'persona', 'research', 'revenue', 'contact', 'sources'];

function switchTab(tabId) {
  const section = document.getElementById(tabId);
  if (!section) return;

  if (!PUBLIC_TABS.includes(tabId) && !currentUser) {
    alert('Access Denied: Please sign in with your TUT student email (@tut4life.ac.za) to access this section.');
    openAuthModal();
    return;
  }

  document.querySelectorAll('.tab-section').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('nav button, .info-nav button').forEach(button => button.classList.remove('active'));

  section.classList.add('active');
  const navBtn = document.getElementById(`nav-${tabId}`);
  if (navBtn) navBtn.classList.add('active');
}

// === AUTH MODAL ===
function applyAuthMode() {
  const modalTitle = document.getElementById('modalTitle');
  const toggleText = document.getElementById('toggleText');
  const toggleBtn = document.getElementById('toggleBtn');

  // Magic links work for both sign-in and first-time registration,
  // so only the wording changes; the button always sends a magic link.
  if (isSignUpMode) {
    if (modalTitle) modalTitle.innerText = 'Create Student Account';
    if (toggleText) toggleText.innerText = 'Already have an account?';
    if (toggleBtn) toggleBtn.innerText = 'Log in here';
  } else {
    if (modalTitle) modalTitle.innerText = 'Student Sign In';
    if (toggleText) toggleText.innerText = "Don't have an account?";
    if (toggleBtn) toggleBtn.innerText = 'Register here';
  }
}

function openAuthModal(signUp = false) {
  isSignUpMode = signUp === true;
  applyAuthMode();
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
  applyAuthMode();
}

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
    if (!supabaseClient || !supabaseClient.auth) {
      throw new Error('Supabase client is not initialized.');
    }

    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: 'https://techcompareos.github.io/TechCompareOs/'
      }
    });

    if (error) throw error;

    alert('Magic link sent! Please check your TUT email inbox.');
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
    const studentNum = escapeHtml((user.email || 'Student').split('@')[0]);
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

async function logoutUser() {
  closeChat();
  if (supabaseClient && supabaseClient.auth) {
    await supabaseClient.auth.signOut();
  }
  teardownChatSubscription();
  currentUser = null;
  updateAuthUI(null);
  filterListings();
  switchTab('home');
  alert('You have logged out.');
}

// === MARKETPLACE (Supabase `products` table) ===
async function loadProducts() {
  const container = document.getElementById('marketplace-container');
  if (!supabaseClient) {
    if (container) container.innerHTML = '<p class="empty-note">Could not connect to the database.</p>';
    return;
  }

  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching products:', error);
    if (container) container.innerHTML = '<p class="empty-note">Could not load listings right now.</p>';
    return;
  }

  allProducts = data || [];
  filterListings();
}

function filterListings() {
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const sortFilter = document.getElementById('sortFilter');

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const selectedCategory = categoryFilter ? categoryFilter.value : 'All';
  const sort = sortFilter ? sortFilter.value : 'featured';

  const filtered = allProducts.filter(item => {
    const haystack = [item.title, item.name, item.brand, item.description, item.category]
      .map(part => String(part ?? '').toLowerCase())
      .join(' ');
    const matchesSearch = !query || haystack.includes(query);
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (sort === 'low') filtered.sort((a, b) => Number(a.price) - Number(b.price));
  if (sort === 'high') filtered.sort((a, b) => Number(b.price) - Number(a.price));

  renderProductCards(filtered);
}

function renderProductCards(products) {
  const container = document.getElementById('marketplace-container');
  const countEl = document.getElementById('activeListingsCount');

  if (countEl) {
    const total = allProducts.length;
    countEl.textContent = `${total} live listing${total === 1 ? '' : 's'}`;
  }
  if (!container) return;

  if (!products || products.length === 0) {
    container.innerHTML = '<p class="empty-note">No listings found matching your search.</p>';
    return;
  }

  container.innerHTML = products.map(item => {
    const title = item.title || item.name || 'Untitled device';
    const sellerEmail = item.seller_email || item.seller_id || '';
    const sellerLabel = String(sellerEmail).split('@')[0] || 'Student';
    const isOwn = currentUser && currentUser.email && currentUser.email === sellerEmail;
    const description = item.description ? `<p class="card-desc">${escapeHtml(item.description)}</p>` : '';

    const action = isOwn
      ? '<p class="own-listing">This is your listing</p>'
      : `<button class="btn-primary btn-chat" data-seller="${escapeHtml(sellerEmail)}" data-product="${escapeHtml(item.id)}">💬 Message Seller</button>`;

    return `
      <div class="listing-card">
        ${item.image_url ? `<img class="card-img" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(title)}" loading="lazy" />` : ''}
        <div class="card-header">
          <span class="card-tag">${escapeHtml(item.category || 'Device')}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        ${description}
        <p class="price">R ${Number(item.price || 0).toLocaleString()}</p>
        <p class="seller">Seller: ${escapeHtml(sellerLabel)}</p>
        ${action}
      </div>
    `;
  }).join('');
}

// === SELL: upload image + insert listing ===
async function uploadProduct() {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  if (!supabaseClient) {
    alert('Could not connect to the database.');
    return;
  }

  const title = document.getElementById('sellTitle').value.trim();
  const category = document.getElementById('sellCategory').value;
  const price = Number(document.getElementById('sellPrice').value);
  const description = document.getElementById('sellDesc').value.trim();
  const fileInput = document.getElementById('sellImage');
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;
  const btn = document.getElementById('sellSubmitBtn');

  if (!title || !Number.isFinite(price) || price <= 0) {
    alert('Please enter a device name and a valid asking price.');
    return;
  }
  if (file) {
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file (JPG, PNG or WebP).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      alert('That picture is larger than 5 MB. Please choose a smaller one.');
      return;
    }
  }

  const originalText = btn ? btn.innerText : '';
  if (btn) {
    btn.disabled = true;
    btn.innerText = file ? 'Uploading picture...' : 'Publishing...';
  }

  try {
    let imageUrl = null;

    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${currentUser.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabaseClient.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabaseClient.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      imageUrl = urlData.publicUrl;
    }

    const { error: insertError } = await supabaseClient
      .from('products')
      .insert([{
        title,
        category,
        price,
        description: description || null,
        image_url: imageUrl,
        seller_email: currentUser.email
      }]);
    if (insertError) throw insertError;

    document.getElementById('sellTitle').value = '';
    document.getElementById('sellPrice').value = '';
    document.getElementById('sellDesc').value = '';
    if (fileInput) fileInput.value = '';

    await loadProducts();
    switchTab('marketplace');
    alert('Device listing published successfully!');
  } catch (err) {
    console.error('Publish failed:', err);
    alert('Could not publish your listing: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = originalText;
    }
  }
}

// === REALTIME CHAT ===
function openChat(sellerEmail, productId) {
  if (!currentUser) {
    alert('Please sign in to message sellers.');
    openAuthModal();
    return;
  }
  if (!sellerEmail) return alert('This listing has no seller contact.');
  if (currentUser.email === sellerEmail) return alert('This is your own listing!');

  activeChatPartner = sellerEmail;
  activeProductId = productId;

  const titleEl = document.getElementById('chatRecipientTitle');
  if (titleEl) titleEl.innerText = `Chat with ${sellerEmail.split('@')[0]}`;

  const modalEl = document.getElementById('chatModal');
  if (modalEl) modalEl.style.display = 'flex';

  loadChatMessages();
  ensureChatSubscription();
}

function closeChat() {
  const modalEl = document.getElementById('chatModal');
  if (modalEl) modalEl.style.display = 'none';
  activeChatPartner = null;
  activeProductId = null;
}

async function loadChatMessages() {
  if (!supabaseClient || !currentUser || !activeChatPartner) return;

  const me = currentUser.email;
  const partner = activeChatPartner;

  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('*')
    .or(`and(sender_email.eq.${me},receiver_email.eq.${partner}),and(sender_email.eq.${partner},receiver_email.eq.${me})`)
    .order('created_at', { ascending: true });

  if (error) return console.error('Error loading chat:', error);
  if (partner !== activeChatPartner) return; // chat was closed or switched meanwhile

  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;

  if (!messages || messages.length === 0) {
    chatBox.innerHTML = '<p class="empty-note">No messages yet. Say hello!</p>';
    return;
  }

  chatBox.innerHTML = messages.map(msg => {
    const isMe = msg.sender_email === me;
    return `<div class="chat-msg ${isMe ? 'sent' : 'received'}"><p>${escapeHtml(msg.message_text)}</p></div>`;
  }).join('');

  chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input || !supabaseClient) return;
  const text = input.value.trim();
  if (!text || !currentUser || !activeChatPartner) return;

  const { error } = await supabaseClient
    .from('messages')
    .insert([{
      sender_email: currentUser.email,
      receiver_email: activeChatPartner,
      product_id: activeProductId,
      message_text: text
    }]);

  if (error) {
    alert('Failed to send message: ' + error.message);
  } else {
    input.value = '';
    loadChatMessages();
  }
}

// Creates the realtime channel only once; later calls do nothing.
function ensureChatSubscription() {
  if (!supabaseClient || chatChannel) return;

  chatChannel = supabaseClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (!currentUser || !activeChatPartner) return;
      const msg = payload.new;
      const involvesThisChat =
        (msg.sender_email === activeChatPartner && msg.receiver_email === currentUser.email) ||
        (msg.sender_email === currentUser.email && msg.receiver_email === activeChatPartner);
      if (involvesThisChat) loadChatMessages();
    })
    .subscribe();
}

function teardownChatSubscription() {
  if (supabaseClient && chatChannel) {
    supabaseClient.removeChannel(chatChannel);
  }
  chatChannel = null;
}

// === TRADE-IN ESTIMATOR ===
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

// === AI ADVISOR (rule-based for now) ===
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
    rec = budget >= 6000
      ? 'Core i5 / Ryzen 5 processor, 16 GB RAM, and SSD for IDEs & programming.'
      : 'Core i5-class processor with 8 GB RAM (upgradable).';
  } else if (program === 'it') {
    rec = budget >= 4500
      ? 'Core i5 processor with 8 GB RAM and SSD.'
      : 'Refurbished laptop with at least 8 GB RAM.';
  } else {
    rec = 'Reliable entry-level notebook or tablet for reading and coursework.';
  }

  result.textContent = rec;
  result.hidden = false;
}

// === REVENUE CALCULATOR (premium listing + monthly support subscription) ===
const LISTING_FEE = 10;       // rand per device listed
const SUBSCRIPTION_FEE = 5;   // rand per subscribed student per month

function formatRand(amount) {
  return 'R' + amount.toLocaleString('en-ZA');
}

function runRevenueCalc() {
  const listingsEl = document.getElementById('revListings');
  const subsEl = document.getElementById('revSubs');
  const result = document.getElementById('revenueResult');
  if (!listingsEl || !subsEl || !result) return;

  const listings = Number(listingsEl.value);
  const subs = Number(subsEl.value);

  if (listingsEl.value === '' || subsEl.value === '' ||
      !Number.isInteger(listings) || !Number.isInteger(subs) || listings < 0 || subs < 0) {
    result.textContent = 'Please enter whole numbers of 0 or more.';
    return;
  }

  const listingIncome = listings * LISTING_FEE;
  const subscriptionIncome = subs * SUBSCRIPTION_FEE;
  const monthly = listingIncome + subscriptionIncome;

  result.innerHTML = `
    <strong>Estimated monthly revenue: ${formatRand(monthly)}</strong><br>
    Listings: ${listings} × R${LISTING_FEE} = ${formatRand(listingIncome)}<br>
    Subscriptions: ${subs} × R${SUBSCRIPTION_FEE} = ${formatRand(subscriptionIncome)}<br>
    Estimated yearly revenue: ${formatRand(monthly * 12)}
  `;
}

// === CONTACT FORM ===
async function submitContact() {
  const nameEl = document.getElementById('contactName');
  const emailEl = document.getElementById('contactEmail');
  const messageEl = document.getElementById('contactMessage');
  const btn = document.getElementById('contactSubmitBtn');
  const result = document.getElementById('contactResult');

  const name = nameEl.value.trim();
  const email = emailEl.value.trim();
  const message = messageEl.value.trim();

  const showResult = text => {
    result.textContent = text;
    result.hidden = false;
  };

  if (!name) return showResult('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showResult('Please enter a valid email address.');
  if (message.length < 10) return showResult('Please write a message of at least 10 characters.');
  if (!supabaseClient) return showResult('Could not connect right now. Please try again later.');

  btn.disabled = true;
  const originalText = btn.innerText;
  btn.innerText = 'Sending...';

  try {
    const { error } = await supabaseClient
      .from('contact_messages')
      .insert([{ name, email, message }]);
    if (error) throw error;

    nameEl.value = '';
    emailEl.value = '';
    messageEl.value = '';
    showResult('Thank you! Your message has been sent.');
  } catch (err) {
    console.error('Contact form failed:', err);
    showResult('Sorry, your message could not be sent. Please try again later.');
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

// === CHATBOT WIDGET ===
function handleBotQuery(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('botInput');
  const logs = document.getElementById('botChatLogs');
  if (!input || !logs) return;

  const msg = input.value.trim();
  if (!msg) return;

  logs.innerHTML += `<div class="bot-msg user">${escapeHtml(msg)}</div>`;
  input.value = '';

  const q = msg.toLowerCase();
  let answer = 'Ask me about finding a device, selling on campus, or specs for your course.';
  if (q.includes('sell')) answer = 'Sign in, go to the Sell tab, and complete the device details to publish.';
  else if (q.includes('buy') || q.includes('laptop') || q.includes('phone')) answer = 'Open Marketplace to view available devices listed by students.';
  else if (/\b(hi|hello|hey)\b/.test(q)) answer = 'Hello! How can I help you on campus today?';

  logs.innerHTML += `<div class="bot-msg bot">${answer}</div>`;
  logs.scrollTop = logs.scrollHeight;
}

function toggleBot() {
  const content = document.getElementById('botContent');
  if (content) content.hidden = !content.hidden;
}

// === EVENT WIRING ===
// Card buttons carry their data in attributes, so nothing user-supplied is put inside inline JS.
document.addEventListener('click', event => {
  const chatBtn = event.target.closest('.btn-chat');
  if (chatBtn) openChat(chatBtn.dataset.seller, chatBtn.dataset.product);
});

async function checkAuthSession() {
  if (!supabaseClient || !supabaseClient.auth) return;

  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session?.user) {
      currentUser = data.session.user;
      updateAuthUI(currentUser);
      filterListings();
    }
  } catch (error) {
    console.warn('Supabase session check failed:', error);
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      updateAuthUI(currentUser);
      closeAuthModal();
      filterListings();
      const home = document.getElementById('home');
      if (home && home.classList.contains('active')) switchTab('marketplace');
    } else if (event === 'SIGNED_OUT') {
      teardownChatSubscription();
      currentUser = null;
      updateAuthUI(null);
      filterListings();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  runRevenueCalc();
  checkAuthSession();
  loadProducts();
});