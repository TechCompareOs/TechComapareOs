// === SUPABASE INITIALIZATION ===
const SUPABASE_URL = "https://hizmjehkwbgmrlxezvcl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NvyZ8UYqTfZ5kQOhI87z0w_tOBpX9Ha";
const PAYMENTS_API = 'https:https://techcomapareos.onrender.com; //Python payments server URL
const IMAGE_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const LISTING_DAYS = 30;                 // a listing stays live this long unless the seller renews it
const DAY_MS = 24 * 60 * 60 * 1000;

let supabaseClient = null;
if (window.supabase && typeof window.supabase.createClient === 'function') {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let currentUser = null;
let isSignUpMode = false;
let pendingAuthEmail = '';
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

  if (tabId === 'mylistings') renderMyListings();
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
  showCodeStep(false);
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
  submitBtn.innerText = 'Sending code...';
  submitBtn.disabled = true;

  try {
    if (!supabaseClient || !supabaseClient.auth) {
      throw new Error('Supabase client is not initialized.');
    }

    // Send the student back to wherever the site is hosted, so this keeps working
    // whatever the GitHub repository is called.
    const siteUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, '');

    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: siteUrl
      }
    });

    if (error) throw error;

    // Show the code box. Students can type the code OR click the link in the email.
    pendingAuthEmail = email;
    showCodeStep(true);
  } catch (err) {
    alert('Authentication Error: ' + err.message);
  } finally {
    submitBtn.innerText = originalText;
    submitBtn.disabled = false;
  }
}


// === SIGN-IN CODE + MICROSOFT SIGN-IN ===
function showCodeStep(show) {
  const authForm = document.getElementById('authForm');
  const codeForm = document.getElementById('codeForm');
  const ms = document.getElementById('msSection');
  const help = document.getElementById('codeHelp');
  if (authForm) authForm.style.display = show ? 'none' : '';
  if (codeForm) codeForm.style.display = show ? '' : 'none';
  if (ms) ms.style.display = show ? 'none' : '';
  if (help && show) help.innerText = 'We sent a code to ' + pendingAuthEmail + '. Check your inbox and your Junk folder.';
  const code = document.getElementById('authCode');
  if (show && code) { code.value = ''; code.focus(); }
}

function backToEmailStep(event) {
  if (event) event.preventDefault();
  showCodeStep(false);
}

async function handleCodeVerify(event) {
  if (event) event.preventDefault();
  const token = document.getElementById('authCode')?.value.replace(/\s+/g, '');
  const btn = document.getElementById('codeSubmitBtn');
  if (!token || !pendingAuthEmail) return;

  const original = btn.innerText;
  btn.innerText = 'Checking...';
  btn.disabled = true;
  try {
    const { error } = await supabaseClient.auth.verifyOtp({ email: pendingAuthEmail, token, type: 'email' });
    if (error) throw error;
    // onAuthStateChange (SIGNED_IN) closes the modal and loads the marketplace
  } catch (err) {
    alert('That code did not work: ' + err.message + '. Check the code, or go back and request a new one.');
  } finally {
    btn.innerText = original;
    btn.disabled = false;
  }
}

async function signInWithMicrosoft() {
  try {
    const siteUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email', redirectTo: siteUrl }
    });
    if (error) throw error;
  } catch (err) {
    alert('Microsoft sign-in error: ' + err.message);
  }
}

// If someone signs in with Microsoft using a non-TUT account, sign them straight back out
function enforceTutEmail(user) {
  const e = (user?.email || '').toLowerCase();
  if (e && !e.endsWith('@tut4life.ac.za') && !e.endsWith('@tut.ac.za')) {
    alert('Only TUT student accounts (@tut4life.ac.za) can use TechCompare OS.');
    supabaseClient.auth.signOut();
    return false;
  }
  return true;
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
      <button class="btn-primary" onclick="openInbox()" id="inboxBtn">📩 Messages <span id="inboxBadge" style="display:none;background:#c00;color:#fff;border-radius:10px;padding:0 6px;font-size:0.75rem;margin-left:4px;"></span></button>
      <button class="btn-primary" onclick="logoutUser()">Log Out</button>
    `;
    if (typeof ensureChatSubscription === 'function') { ensureChatSubscription(); refreshInboxBadge(); }
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
  allProducts = [];
  updateAuthUI(null);
  filterListings();
  renderMyListings();
  switchTab('home');
  alert('You have logged out.');
}

// === LISTING LIFE CYCLE: Available -> Sold, or expires after LISTING_DAYS ===
function isSold(item) {
  return item.status === 'Sold';
}

function isExpired(item) {
  return !!item.expires_at && new Date(item.expires_at).getTime() <= Date.now();
}

// A listing shows in the marketplace only while it is available and not expired.
// (Rows from before the status/expires_at columns existed count as available.)
function isLive(item) {
  return !isSold(item) && !isExpired(item);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ageLabel(item) {
  if (!item.created_at) return '';
  const days = Math.max(0, Math.floor((Date.now() - new Date(item.created_at).getTime()) / DAY_MS));
  return days === 0 ? 'Listed today' : `Listed ${plural(days, 'day')} ago`;
}

function expiryLabel(item) {
  if (isSold(item)) return 'Sold';
  if (!item.expires_at) return '';
  const diff = new Date(item.expires_at).getTime() - Date.now();
  if (diff <= 0) {
    const daysAgo = Math.max(0, Math.floor(-diff / DAY_MS));
    return daysAgo === 0 ? 'Expired today' : `Expired ${plural(daysAgo, 'day')} ago`;
  }
  return `Expires in ${plural(Math.ceil(diff / DAY_MS), 'day')}`;
}

// === MARKETPLACE (Supabase `products` table) ===
async function loadProducts() {
  const container = document.getElementById('marketplace-container');
  if (!supabaseClient) {
    if (container) container.innerHTML = '<p class="empty-note">Could not connect to the database.</p>';
    return;
  }

  // Listings are for signed-in TUT students only
  if (!currentUser) {
    allProducts = [];
    filterListings();
    renderMyListings();
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
  renderMyListings();
}

function filterListings() {
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const sortFilter = document.getElementById('sortFilter');

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const selectedCategory = categoryFilter ? categoryFilter.value : 'All';
  const sort = sortFilter ? sortFilter.value : 'featured';

  const filtered = allProducts.filter(item => {
    if (!isLive(item)) return false;
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
    countEl.textContent = currentUser
      ? plural(allProducts.filter(isLive).length, 'live listing')
      : 'Sign in to see live listings';
  }
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<p class="empty-note">Sign in with your TUT email to see live listings.</p>';
    return;
  }
  if (!products || products.length === 0) {
    container.innerHTML = '<p class="empty-note">No listings found matching your search.</p>';
    return;
  }

  container.innerHTML = products.map(item => {
    const title = item.title || item.name || 'Untitled device';
    const sellerEmail = item.seller_email || item.seller_id || '';
    const sellerLabel = String(sellerEmail).split('@')[0] || 'Student';
    const isOwn = currentUser && currentUser.email && mailKey(currentUser.email) === mailKey(sellerEmail);
    const description = item.description ? `<p class="card-desc">${escapeHtml(item.description)}</p>` : '';

    const action = isOwn
      ? '<p class="own-listing">This is your listing</p>'
      : `<button class="btn-primary btn-buy" data-product="${escapeHtml(item.id)}" style="margin-bottom:0.4rem;">🛒 Buy Now (secure, with delivery)</button>
         <button class="btn-primary btn-chat" data-seller="${escapeHtml(sellerEmail)}" data-product="${escapeHtml(item.id)}">💬 Message Seller</button>`;

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
        <p class="age-note">${escapeHtml([ageLabel(item), expiryLabel(item)].filter(Boolean).join(' · '))}</p>
        ${action}
      </div>
    `;
  }).join('');
}

// === MY LISTINGS: mark sold, edit price, renew, delete ===
function renderMyListings() {
  const container = document.getElementById('mylistings-container');
  const summary = document.getElementById('mylistingsSummary');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<p class="empty-note">Sign in to see your listings.</p>';
    if (summary) summary.textContent = '';
    return;
  }

  const mine = allProducts.filter(item => mailKey(item.seller_email) === mailKey(currentUser.email));
  const live = mine.filter(isLive).length;
  const sold = mine.filter(isSold).length;
  const expired = mine.filter(item => !isSold(item) && isExpired(item)).length;
  if (summary) summary.textContent = `${live} live · ${sold} sold · ${expired} expired`;

  if (mine.length === 0) {
    container.innerHTML = '<p class="empty-note">You have not listed any devices yet. Use the Sell Device tab to add one.</p>';
    return;
  }

  container.innerHTML = mine.map(item => {
    const title = item.title || item.name || 'Untitled device';
    const id = escapeHtml(item.id);
    const state = isSold(item) ? 'sold' : (isExpired(item) ? 'expired' : 'live');
    const stateText = { live: 'Live', sold: 'Sold', expired: 'Expired' }[state];

    const buttons = [];
    if (state === 'live') {
      buttons.push(`<button class="btn-small btn-ok" data-action="sold" data-id="${id}">Mark as sold</button>`);
      buttons.push(`<button class="btn-small" data-action="price" data-id="${id}">Edit price</button>`);
    }
    const renewText = state === 'live' ? `Renew ${LISTING_DAYS} days`
      : (state === 'sold' ? 'Relist' : `Renew for ${LISTING_DAYS} days`);
    buttons.push(`<button class="btn-small" data-action="renew" data-id="${id}">${renewText}</button>`);
    buttons.push(`<button class="btn-small btn-danger" data-action="delete" data-id="${id}">Delete</button>`);

    return `
      <div class="listing-card is-${state}">
        ${item.image_url ? `<img class="card-img" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(title)}" loading="lazy" />` : ''}
        <div class="card-header">
          <span class="card-tag">${escapeHtml(item.category || 'Device')}</span>
          <span class="status-badge status-${state}">${stateText}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p class="price">R ${Number(item.price || 0).toLocaleString()}</p>
        <p class="age-note">${escapeHtml([ageLabel(item), expiryLabel(item)].filter(Boolean).join(' · '))}</p>
        <div class="my-actions">${buttons.join('')}</div>
      </div>
    `;
  }).join('');
}

// Changes one of the signed-in student's own listings.
// The database also enforces ownership (see setup.sql); .select() lets us notice a change that was refused.
async function updateListing(id, changes) {
  if (!supabaseClient || !currentUser) return false;

  const { data, error } = await supabaseClient
    .from('products')
    .update(changes)
    .eq('id', id)
    .eq('seller_email', currentUser.email)
    .select();

  if (error) {
    console.error('Update failed:', error);
    const hint = /column|status|expires_at/i.test(error.message || '')
      ? ' Run the latest setup.sql in Supabase first.' : '';
    alert('Could not update the listing: ' + error.message + hint);
    return false;
  }
  if (!data || data.length === 0) {
    alert('That listing could not be changed. It may not be yours, or it was already removed.');
    return false;
  }
  return true;
}

async function deleteListing(item) {
  const { data, error } = await supabaseClient
    .from('products')
    .delete()
    .eq('id', item.id)
    .eq('seller_email', currentUser.email)
    .select();

  if (error) {
    alert('Could not delete the listing: ' + error.message);
    return false;
  }
  if (!data || data.length === 0) {
    alert('That listing could not be deleted. It may not be yours, or it was already removed.');
    return false;
  }

  // Remove the picture too, so deleted listings do not leave files behind
  const path = imagePathFromUrl(item.image_url);
  if (path) {
    const { error: removeError } = await supabaseClient.storage.from(IMAGE_BUCKET).remove([path]);
    if (removeError) console.warn('Picture could not be removed:', removeError);
  }
  return true;
}

function imagePathFromUrl(url) {
  if (!url) return null;
  const marker = `/object/public/${IMAGE_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
}

async function handleListingAction(action, id) {
  const item = allProducts.find(product => String(product.id) === String(id));
  if (!item || !currentUser) return;

  let done = false;

  if (action === 'sold') {
    done = await updateListing(item.id, { status: 'Sold' });
  } else if (action === 'renew') {
    done = await updateListing(item.id, {
      status: 'Available',
      expires_at: new Date(Date.now() + LISTING_DAYS * DAY_MS).toISOString()
    });
  } else if (action === 'price') {
    const answer = prompt('New asking price (R):', item.price);
    if (answer === null) return;
    const price = Number(String(answer).replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
      alert('Please enter a valid price greater than 0.');
      return;
    }
    done = await updateListing(item.id, { price });
  } else if (action === 'delete') {
    if (!confirm('Delete this listing permanently? This cannot be undone.')) return;
    done = await deleteListing(item);
  }

  if (done) await loadProducts();
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
    alert(`Device listing published! It stays live for ${LISTING_DAYS} days. You can renew, edit or remove it from My Listings.`);
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

// === REALTIME CHAT + INBOX ===
const mailKey = e => String(e || '').trim().toLowerCase();
const myEmail = () => mailKey(currentUser && currentUser.email);
let inboxPoll = null;

function seenStore() {
  try { return JSON.parse(localStorage.getItem('tc_seen_' + myEmail()) || '{}'); } catch (_) { return {}; }
}
function markSeen(partner) {
  try {
    const s = seenStore();
    s[mailKey(partner)] = new Date().toISOString();
    localStorage.setItem('tc_seen_' + myEmail(), JSON.stringify(s));
  } catch (_) {}
}

// All of my messages, newest first. (The database also restricts this to messages I sent or received.)
async function fetchMyMessages() {
  if (!supabaseClient || !currentUser) return [];
  const { data, error } = await supabaseClient
    .from('messages').select('*')
    .order('created_at', { ascending: false }).limit(500);
  if (error) { console.error('Error loading messages:', error); return []; }
  const me = myEmail();
  return (data || []).filter(m => mailKey(m.sender_email) === me || mailKey(m.receiver_email) === me);
}

function groupConversations(messages) {
  const me = myEmail();
  const seen = seenStore();
  const map = new Map();
  for (const m of messages) { // newest first, so the first one we see per person is the latest
    const partner = mailKey(m.sender_email) === me ? mailKey(m.receiver_email) : mailKey(m.sender_email);
    if (!partner || map.has(partner)) continue;
    const fromThem = mailKey(m.sender_email) !== me;
    const unread = fromThem && (!seen[partner] || new Date(m.created_at) > new Date(seen[partner]));
    map.set(partner, { partner, last: m, unread });
  }
  return [...map.values()];
}

async function refreshInboxBadge() {
  const badge = document.getElementById('inboxBadge');
  if (!badge || !currentUser) return;
  const convos = groupConversations(await fetchMyMessages());
  const n = convos.filter(c => c.unread).length;
  badge.textContent = n ? String(n) : '';
  badge.style.display = n ? 'inline-block' : 'none';
}

async function renderInbox() {
  const list = document.getElementById('inboxList');
  if (!list) return;
  const convos = groupConversations(await fetchMyMessages());
  if (!convos.length) {
    list.innerHTML = '<p class="empty-note">No messages yet. When a student messages you about a listing, it will show up here.</p>';
    return;
  }
  list.innerHTML = convos.map(c => {
    const snippet = escapeHtml(String(c.last.message_text || '').slice(0, 60));
    const when = new Date(c.last.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    return `<button type="button" class="inbox-item" data-partner="${escapeHtml(c.partner)}" data-product="${escapeHtml(c.last.product_id ?? '')}"
      onclick="openConversation(this.dataset.partner, this.dataset.product)"
      style="display:block;width:100%;text-align:left;padding:0.7rem;margin-bottom:0.5rem;border:1px solid #ccd;border-radius:8px;background:${c.unread ? '#fff6dd' : '#fff'};cursor:pointer;">
      <strong>${escapeHtml(c.partner.split('@')[0])}</strong>${c.unread ? ' <span style="color:#c00;font-size:0.8rem;">● new</span>' : ''}
      <span style="float:right;font-size:0.75rem;opacity:0.7;">${escapeHtml(when)}</span><br>
      <span style="font-size:0.85rem;opacity:0.8;">${snippet}</span></button>`;
  }).join('');
}

function openInbox() {
  if (!currentUser) { openAuthModal(); return; }
  const modal = document.getElementById('inboxModal');
  if (modal) modal.style.display = 'flex';
  renderInbox();
}
function closeInbox() {
  const modal = document.getElementById('inboxModal');
  if (modal) modal.style.display = 'none';
}
function openConversation(partner, productId) {
  closeInbox();
  openChat(partner, productId || null);
}

function openChat(sellerEmail, productId) {
  if (!currentUser) {
    alert('Please sign in to message sellers.');
    openAuthModal();
    return;
  }
  const partner = mailKey(sellerEmail);
  if (!partner) return alert('This listing has no seller contact.');
  if (partner === myEmail()) return alert('This is your own listing!');

  activeChatPartner = partner;
  activeProductId = productId || null;

  const titleEl = document.getElementById('chatRecipientTitle');
  if (titleEl) titleEl.innerText = `Chat with ${partner.split('@')[0]}`;

  const modalEl = document.getElementById('chatModal');
  if (modalEl) modalEl.style.display = 'flex';

  markSeen(partner);
  loadChatMessages();
  ensureChatSubscription();
}

function closeChat() {
  const modalEl = document.getElementById('chatModal');
  if (modalEl) modalEl.style.display = 'none';
  if (activeChatPartner) markSeen(activeChatPartner);
  activeChatPartner = null;
  activeProductId = null;
  refreshInboxBadge();
}

async function loadChatMessages() {
  if (!supabaseClient || !currentUser || !activeChatPartner) return;

  const me = myEmail();
  const partner = activeChatPartner;
  const all = await fetchMyMessages();
  if (partner !== activeChatPartner) return; // chat was closed or switched meanwhile

  const messages = all
    .filter(m => {
      const s = mailKey(m.sender_email), r = mailKey(m.receiver_email);
      return (s === me && r === partner) || (s === partner && r === me);
    })
    .reverse(); // oldest first

  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;

  if (messages.length === 0) {
    chatBox.innerHTML = '<p class="empty-note">No messages yet. Say hello!</p>';
    return;
  }

  chatBox.innerHTML = messages.map(msg => {
    const isMe = mailKey(msg.sender_email) === me;
    return `<div class="chat-msg ${isMe ? 'sent' : 'received'}"><p>${escapeHtml(msg.message_text)}</p></div>`;
  }).join('');

  chatBox.scrollTop = chatBox.scrollHeight;
  markSeen(partner);
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input || !supabaseClient) return;
  const text = input.value.trim();
  if (!text || !currentUser || !activeChatPartner) return;

  const { error } = await supabaseClient
    .from('messages')
    .insert([{
      sender_email: myEmail(),
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

// Creates the realtime channel once (plus a 30s fallback check); later calls do nothing.
function ensureChatSubscription() {
  if (!supabaseClient || chatChannel) return;

  chatChannel = supabaseClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (!currentUser) return;
      const msg = payload.new;
      const me = myEmail(), s = mailKey(msg.sender_email), r = mailKey(msg.receiver_email);
      if (s !== me && r !== me) return;
      if (activeChatPartner && (s === activeChatPartner || r === activeChatPartner)) loadChatMessages();
      refreshInboxBadge();
      const inbox = document.getElementById('inboxModal');
      if (inbox && inbox.style.display === 'flex') renderInbox();
    })
    .subscribe();

  if (!inboxPoll) inboxPoll = setInterval(refreshInboxBadge, 30000);
}

function teardownChatSubscription() {
  if (supabaseClient && chatChannel) {
    supabaseClient.removeChannel(chatChannel);
  }
  chatChannel = null;
  if (inboxPoll) { clearInterval(inboxPoll); inboxPoll = null; }
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
  const buyBtn = event.target.closest('.btn-buy');
  if (buyBtn) {
    if (!currentUser) { openAuthModal(); return; }
    const product = allProducts.find(p => String(p.id) === buyBtn.dataset.product);
    if (typeof TechCheckout === 'undefined') { alert('Checkout is not loaded. Upload checkout.js to the same folder as index.html on the main branch, then hard-refresh.'); return; }
    if (!product) { alert('Could not find this listing. Refresh the page and try again.'); return; }
    TechCheckout.buy(product);
  }

  const chatBtn = event.target.closest('.btn-chat');
  if (chatBtn) openChat(chatBtn.dataset.seller, chatBtn.dataset.product);

  const listingBtn = event.target.closest('#mylistings-container button[data-action]');
  if (listingBtn) handleListingAction(listingBtn.dataset.action, listingBtn.dataset.id);
});

async function checkAuthSession() {
  if (!supabaseClient || !supabaseClient.auth) return;

  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session?.user) {
      currentUser = data.session.user;
      updateAuthUI(currentUser);
    }
  } catch (error) {
    console.warn('Supabase session check failed:', error);
  }

  // Load listings only once we know whether a student is signed in
  await loadProducts();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      if (!enforceTutEmail(session.user)) return;
      currentUser = session.user;
      updateAuthUI(currentUser);
      closeAuthModal();
      loadProducts();
      const home = document.getElementById('home');
      if (home && home.classList.contains('active')) switchTab('marketplace');
    } else if (event === 'SIGNED_OUT') {
      teardownChatSubscription();
      currentUser = null;
      allProducts = [];
      updateAuthUI(null);
      filterListings();
      renderMyListings();
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
  if (typeof TechCheckout !== 'undefined') {
    TechCheckout.init(supabaseClient, PAYMENTS_API);
    TechCheckout.handleReturn();
  }
  checkAuthSession(); // also loads the listings, once the session is known
});
