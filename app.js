// === SUPABASE INITIALIZATION ===
const SUPABASE_URL = "https://hizmjehkwbgmrlxezvcl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NvyZ8UYqTfZ5kQOhI87z0w_tOBpX9Ha";

let supabaseClient = null;
if (window.supabase && typeof window.supabase.createClient  === 'function') {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let currentUser = null;
let isSignUpMode = false;
let activeChatPartner = null;
let activeProductId = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

// --- AUTH & UI HELPERS ---
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

function openAuthModal(signUp = false) {
  isSignUpMode = signUp;
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'flex';
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
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

// --- MAGIC LINK AUTH ---
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
      throw new Error("Supabase client is not initialized.");
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

// --- SUPABASE MARKETPLACE & PRODUCTS ---
async function loadProducts() {
  if (!supabaseClient) return;
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return console.error('Error fetching products:', error);
  renderProductCards(products || []);
}

function renderProductCards(products) {
  const container = document.getElementById('marketplaceGrid') || document.getElementById('marketplace-container');
  if (!container) return;
  
  if (products.length === 0) {
    container.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:2rem; color:#6c757d;">No live listings found yet.</p>';
    return;
  }

  container.innerHTML = products.map(item => `
    <div class="product-card">
      ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title || item.name)}" style="width:100%; height:150px; object-fit:cover;" />` : ''}
      <h4>${escapeHtml(item.title || item.name)}</h4>
      <p class="price">R ${Number(item.price || 0).toLocaleString()}</p>
      <span class="badge">${escapeHtml(item.category)}</span>
      <p class="seller">Seller: ${escapeHtml(item.seller_email || item.seller_id)}</p>
      <button onclick="openChat('${escapeHtml(item.seller_email || item.seller_id)}', '${escapeHtml(item.id)}')" class="btn-chat btn-primary" style="margin-top:10px; width:100%;">
        💬 Message Seller
      </button>
    </div>
  `).join('');
}

// --- REALTIME CHAT SYSTEM ---
function openChat(sellerEmail, productId) {
  if (!currentUser) return alert('Please sign in to message sellers.');
  if (currentUser.email === sellerEmail) return alert('This is your own listing!');

  activeChatPartner = sellerEmail;
  activeProductId = productId;
  
  const titleEl = document.getElementById('chatRecipientTitle');
  if (titleEl) titleEl.innerText = `Chat with ${sellerEmail}`;
  
  const modalEl = document.getElementById('chatModal');
  if (modalEl) modalEl.style.display = 'flex';

  loadChatMessages();
  subscribeToDirectMessages();
}

function closeChat() {
  const modalEl = document.getElementById('chatModal');
  if (modalEl) modalEl.style.display = 'none';
}

async function loadChatMessages() {
  if (!currentUser || !activeChatPartner) return;
  
  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('*')
    .or(`and(sender_email.eq.${currentUser.email},receiver_email.eq.${activeChatPartner}),and(sender_email.eq.${activeChatPartner},receiver_email.eq.${currentUser.email})`)
    .order('created_at', { ascending: true });

  if (error) return console.error('Error loading chat:', error);

  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;

  chatBox.innerHTML = (messages || []).map(msg => {
    const isMe = msg.sender_email === currentUser.email;
    return `
      <div class="message ${isMe ? 'sent' : 'received'}" style="margin: 5px 0; text-align: ${isMe ? 'right' : 'left'};">
        <p style="background: ${isMe ? '#dcf8c6' : '#f1f0f0'}; padding: 8px 12px; border-radius: 8px; display: inline-block;">${escapeHtml(msg.message_text)}</p>
      </div>
    `;
  }).join('');
  
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
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

function subscribeToDirectMessages() {
  if (!supabaseClient) return;
  supabaseClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (
        (payload.new.sender_email === activeChatPartner && payload.new.receiver_email === currentUser.email) ||
        (payload.new.sender_email === currentUser.email && payload.new.receiver_email === activeChatPartner)
      ) {
        loadChatMessages();
      }
    })
    .subscribe();
}

// --- INITIALIZATION ON LOAD ---
async function checkAuthSession() {
  if (!supabaseClient) return;
  
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    updateAuthUI(currentUser);
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      updateAuthUI(currentUser);
      const modal = document.getElementById('authModal');
      if (modal) modal.style.display = 'none';
      if (typeof switchTab === 'function') switchTab('marketplace');
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      updateAuthUI(null);
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
  loadProducts();
});