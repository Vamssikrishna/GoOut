import { useState, useEffect, useCallback } from 'react';
import api, { getAssetUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ManualLocationPicker from '../components/explorer/ManualLocationPicker';
import MerchantAnalyticsPanel from '../components/merchant/MerchantAnalyticsPanel';

function getMerchantBusinessId(user) {
  if (!user?.businessId) return null;
  return user.businessId._id || user.businessId;
}

function formatAddressFromLocation(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return '';
  return `Pinned location (${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)})`;
}

const PRIMARY_CATEGORIES = [
  'Cafe', 'Bakery', 'Restaurant', 'Boutique', 'Tailor', 'Handcrafts', 'Grocery', 'Salon', 'Bookstore', 'Bar', 'Other'
];

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function defaultWeeklySchedule() {
  const row = { closed: false, open: '09:00', close: '17:00' };
  return Object.fromEntries(DAY_ORDER.map((d) => [d, { ...row }]));
}

function parseHoursHintToWeeklySchedule(text) {
  const raw = String(text || '').toLowerCase();
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  const to24 = (h, min, ap) => {
    let hh = Number(h) % 12;
    if (String(ap).toLowerCase() === 'pm') hh += 12;
    const mm = Number(min || 0);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  const open = to24(m[1], m[2], m[3]);
  const close = to24(m[4], m[5], m[6]);
  return Object.fromEntries(DAY_ORDER.map((d) => [d, { closed: false, open, close }]));
}

function normalizeMenuRows(rows) {
  return (rows || [])
    .map((r) => ({
      name: String(r.name || '').trim(),
      price: Number.parseFloat(String(r.price || '').replace(/,/g, '')),
      description: String(r.description || '').trim().slice(0, 300)
    }))
    .filter((r) => r.name && Number.isFinite(r.price) && r.price >= 0);
}

function averagePriceFromItems(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  return Math.round(total / items.length);
}

function verificationIssueRows(summary) {
  const checks = summary?.checks || {};
  const rows = [
    {
      key: 'businessLicense',
      label: 'Business license / registration proof',
      ok: Boolean(checks?.businessLicense?.ok),
      reason: (checks?.businessLicense?.errors || []).join(' ') ||
        checks?.businessLicense?.reason ||
        (checks?.businessLicense?.nameOverlap === false ? 'Business name mismatch with listing.' : '')
    },
    {
      key: 'ownerIdentity',
      label: 'Owner government ID proof',
      ok: Boolean(checks?.ownerIdentity?.ok),
      reason: (checks?.ownerIdentity?.errors || []).join(' ') || checks?.ownerIdentity?.reason || ''
    },
    {
      key: 'storefront',
      label: 'Storefront photo',
      ok: Boolean(checks?.storefront?.ok),
      reason: (checks?.storefront?.errors || []).join(' ') || checks?.storefront?.reason || ''
    }
  ];
  return rows;
}

async function uploadMerchantAsset(file) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/uploads/merchant-asset', fd);
  return data.url;
}

export default function Merchant() {
  const { user, updateUser } = useAuth();
  const { addToast } = useToast();
  const [ownedBusinesses, setOwnedBusinesses] = useState([]);
  const [activeBusinessId, setActiveBusinessId] = useState(null);
  const [business, setBusiness] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [offers, setOffers] = useState([]);
  const [creatingNewBusiness, setCreatingNewBusiness] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    phone: '',
    avgPrice: 0,
    openingHours: '',
    tags: '',
    menu: '',
    greenInitiatives: '',
    isFree: false
  });
  const [aiBlurb, setAiBlurb] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [offerForm, setOfferForm] = useState({ title: '', description: '', offerPrice: '', originalPrice: '', validUntil: '', durationMinutes: 30 });
  const [offerError, setOfferError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingBusiness, setDeletingBusiness] = useState(false);
  const [suggestedLocation, setSuggestedLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [editProfile, setEditProfile] = useState(false);
  const [editTags, setEditTags] = useState('');
  const [aiPreview, setAiPreview] = useState(null);
  const [mapDisplayName, setMapDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [vibe, setVibe] = useState('');
  const [addressStructured, setAddressStructured] = useState({
    street: '',
    neighborhood: '',
    city: '',
    postalCode: ''
  });
  const [weeklySchedule, setWeeklySchedule] = useState(defaultWeeklySchedule);
  const [priceTier, setPriceTier] = useState(2);
  const [primaryCategory, setPrimaryCategory] = useState('Cafe');
  const [licenseDoc, setLicenseDoc] = useState(null);
  const [ownerIdDoc, setOwnerIdDoc] = useState(null);
  const [storefrontUrl, setStorefrontUrl] = useState('');
  const [menuFileUrl, setMenuFileUrl] = useState('');
  const [ecoOptions, setEcoOptions] = useState({ plasticFree: false, solarPowered: false, zeroWaste: false });
  const [localSourcingNote, setLocalSourcingNote] = useState('');
  const [carbonWalkIncentive, setCarbonWalkIncentive] = useState(false);
  const [socialLinks, setSocialLinks] = useState({ website: '', instagram: '', facebook: '' });
  const [menuCatalogText, setMenuCatalogText] = useState('');
  const [notifyBuddyMeetups, setNotifyBuddyMeetups] = useState(true);
  const [notifyFlashDeals, setNotifyFlashDeals] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [menuRows, setMenuRows] = useState([{ name: '', price: '', description: '' }]);
  const [menuPublishBusy, setMenuPublishBusy] = useState(false);
  const [verificationSummary, setVerificationSummary] = useState(null);
  const [verificationTemplates, setVerificationTemplates] = useState(null);
  const [menuPreviewConfirmed, setMenuPreviewConfirmed] = useState(false);

  const merchantBusinessId = getMerchantBusinessId(user);
  const showRegistrationForm = !activeBusinessId || creatingNewBusiness;

  const loadOwnedBusinesses = useCallback(async () => {
    if (!user?.id || user?.role !== 'merchant') return [];
    try {
      const { data } = await api.get('/businesses/mine');
      const rows = Array.isArray(data) ? data : [];
      setOwnedBusinesses(rows);
      return rows;
    } catch {
      setOwnedBusinesses([]);
      return [];
    }
  }, [user?.id, user?.role]);

  const loadBusinessBundle = useCallback(async (businessId) => {
    if (!businessId) return;
    try {
      const bid = String(businessId);
      const [bizRes, analyticsRes, offersRes] = await Promise.all([
        api.get(`/businesses/${bid}`),
        api.get(`/businesses/${bid}/analytics`),
        api.get(`/offers/business/${bid}`)
      ]);
      const data = bizRes.data;
      setBusiness(data);
      setAnalytics(analyticsRes.data);
      setOffers(offersRes.data);
      setEditTags((data.tags || []).join(', '));
      if (Array.isArray(data.menuItems) && data.menuItems.length > 0) {
        setMenuRows(
          data.menuItems.map((m) => ({
            name: m.name || '',
            price: m.price != null && m.price !== '' ? String(m.price) : '',
            description: m.description || ''
          }))
        );
      } else {
        setMenuRows([{ name: '', price: '', description: '' }]);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (merchantBusinessId) {
      setActiveBusinessId(String(merchantBusinessId));
    } else {
      setActiveBusinessId(null);
    }
  }, [merchantBusinessId]);

  useEffect(() => {
    if (!activeBusinessId || creatingNewBusiness) {
      if (!activeBusinessId) {
        setBusiness(null);
        setAnalytics(null);
        setOffers([]);
        setCreatingNewBusiness(false);
      }
      return;
    }
    loadBusinessBundle(activeBusinessId);
  }, [activeBusinessId, creatingNewBusiness, loadBusinessBundle]);

  useEffect(() => {
    if (!user?.id || user?.role !== 'merchant') return;
    loadOwnedBusinesses();
  }, [user?.id, user?.role, loadOwnedBusinesses]);

  useEffect(() => {
    if (!showRegistrationForm || user?.role !== 'merchant') return;
    api.get('/businesses/verification-templates')
      .then(({ data }) => setVerificationTemplates(data || null))
      .catch(() => setVerificationTemplates(null));
  }, [showRegistrationForm, user?.role]);

  useEffect(() => {
    if (!showRegistrationForm) return;
    setContactEmail((prev) => prev || user?.email || '');
  }, [showRegistrationForm, user?.email]);

  const resetNewBusinessForm = () => {
    setForm({
      name: '',
      description: '',
      category: '',
      phone: '',
      avgPrice: 0,
      openingHours: '',
      tags: '',
      menu: '',
      greenInitiatives: '',
      isFree: false
    });
    setAiBlurb('');
    setAiError('');
    setLocationStatus('');
    setSuggestedLocation(null);
    setAiPreview(null);
    setMapDisplayName('');
    setContactEmail(user?.email || '');
    setVibe('');
    setAddressStructured({ street: '', neighborhood: '', city: '', postalCode: '' });
    setWeeklySchedule(defaultWeeklySchedule());
    setPriceTier(2);
    setPrimaryCategory('Cafe');
    setLicenseDoc(null);
    setOwnerIdDoc(null);
    setStorefrontUrl('');
    setMenuFileUrl('');
    setEcoOptions({ plasticFree: false, solarPowered: false, zeroWaste: false });
    setLocalSourcingNote('');
    setCarbonWalkIncentive(false);
    setSocialLinks({ website: '', instagram: '', facebook: '' });
    setMenuCatalogText('');
    setNotifyBuddyMeetups(true);
    setNotifyFlashDeals(true);
    setVerificationSummary(null);
    setVerificationTemplates(null);
    setMenuPreviewConfirmed(false);
  };

  const fillWithAi = async () => {
    const sentence = (aiBlurb.trim() || `${form.name} ${form.category} ${form.description}`.trim()).trim();
    if (sentence.length < 10) {
      addToast({ type: 'error', title: 'Need more text', message: 'Write at least one sentence about your business, or fill some fields first.' });
      return;
    }
    setAiBusy(true);
    setAiError('');
    try {
      const { data } = await api.post('/businesses/onboard-ai', { sentence });
      setAiPreview({
        name: data.name || '',
        category: data.category || '',
        vibe: data.vibe || ''
      });
      const parsedWeekly = parseHoursHintToWeeklySchedule(data.openingHours || '');
      if (parsedWeekly) setWeeklySchedule(parsedWeekly);
      setVibe(String(data.vibe || '').trim());
      setMapDisplayName((m) => m || String(data.name || '').trim());
      const catFromAi = String(data.category || '').trim();
      setPrimaryCategory(PRIMARY_CATEGORIES.includes(catFromAi) ? catFromAi : 'Other');
      setForm((f) => ({
        ...f,
        name: data.name || f.name,
        description: data.description || f.description,
        category: PRIMARY_CATEGORIES.includes(catFromAi) ? catFromAi : (catFromAi || f.category),
        avgPrice: typeof data.avgPrice === 'number' ? data.avgPrice : f.avgPrice,
        openingHours: data.openingHours || f.openingHours,
        isFree: typeof data.isFree === 'boolean' ? data.isFree : f.isFree,
        tags: Array.isArray(data.tags) && data.tags.length ? data.tags.join(', ') : f.tags,
        menu: Array.isArray(data.menu) && data.menu.length ? data.menu.join(', ') : f.menu,
        greenInitiatives: Array.isArray(data.greenInitiatives) && data.greenInitiatives.length ?
          data.greenInitiatives.join(', ') :
          f.greenInitiatives
      }));
      addToast({
        type: 'success',
        title: data.fromCache ? 'Loaded from cache' : 'Form filled with AI',
        message: data.fromCache ? 'Same description was used recently — instant fill.' : 'Review and edit before registering.'
      });
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'AI fill failed';
      setAiError(msg);
      addToast({ type: 'error', title: 'AI fill failed', message: msg });
    } finally {
      setAiBusy(false);
    }
  };

  const takeCurrentLocation = async () => {
    setLocationStatus('');
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation is not supported in this browser.');
      return;
    }
    try {
      const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setSuggestedLocation(loc);
      setLocationStatus('Current location captured successfully.');
      addToast({ type: 'success', title: 'Location captured', message: 'GPS location is ready for registration.' });
    } catch (err) {
      setLocationStatus('Unable to capture GPS location. Please select your location from the map.');
      addToast({ type: 'error', title: 'GPS unavailable', message: 'Please select your location from the map.' });
    }
  };

  // Auto-capture GPS when merchant onboarding form opens so we do not ask again.
  useEffect(() => {
    if (!showRegistrationForm) return;
    if (suggestedLocation?.lat && suggestedLocation?.lng) return;
    if (!navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setSuggestedLocation(loc);
        setLocationStatus('Location captured automatically.');
      },
      () => {
        if (cancelled) return;
        setLocationStatus('Automatic GPS capture failed. Please pick your location from the map.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [showRegistrationForm, suggestedLocation?.lat, suggestedLocation?.lng]);

  const registerBusiness = async (e) => {
    e.preventDefault();
    try {
      if (!suggestedLocation?.lat || !suggestedLocation?.lng) {
        addToast({ type: 'error', title: 'Location required', message: 'Capture GPS location or select location from map before registering.' });
        return;
      }
      if (!licenseDoc?.url || !ownerIdDoc?.url || !storefrontUrl) {
        addToast({ type: 'error', title: 'Verification required', message: 'Upload business license, owner government ID, and storefront photo.' });
        return;
      }
      const menuItems = normalizeMenuRows(menuRows);
      if (!menuItems.length) {
        addToast({ type: 'error', title: 'Menu required', message: 'Add at least one menu item with a valid INR price.' });
        return;
      }
      if (!menuPreviewConfirmed) {
        addToast({ type: 'error', title: 'Confirm menu preview', message: 'Please review and confirm the menu preview before registering.' });
        return;
      }
      const verificationPayload = {
        mapDisplayName: mapDisplayName.trim() || form.name,
        licenseDocUrl: licenseDoc.url,
        ownerIdDocUrl: ownerIdDoc.url,
        storefrontPhotoUrl: storefrontUrl,
        lat: suggestedLocation.lat,
        lng: suggestedLocation.lng
      };
      const { data: verification } = await api.post('/businesses/verify-onboarding-docs', verificationPayload);
      setVerificationSummary(verification);
      if (!verification?.isVerified) {
        const failed = verificationIssueRows(verification).filter((r) => !r.ok).map((r) => r.label).join(', ');
        addToast({
          type: 'error',
          title: 'Verification failed',
          message: failed ? `Please re-upload: ${failed}` : (verification?.summary || 'Documents did not pass verification checks.')
        });
        return;
      }
      addToast({
        type: 'success',
        title: 'Verified',
        message: 'Documents verified by AI. Red Pin will be enabled automatically after registration.'
      });
      const coords = [suggestedLocation.lng, suggestedLocation.lat];
      const splitList = (s) => String(s || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const category = primaryCategory === 'Other' ? (form.category || 'Other') : primaryCategory;
      const avgPrice = averagePriceFromItems(menuItems);
      const { data } = await api.post('/businesses', {
        name: form.name,
        mapDisplayName: mapDisplayName.trim() || form.name,
        description: form.description,
        category,
        vibe: vibe.trim(),
        phone: form.phone,
        contactEmail: contactEmail.trim(),
        avgPrice,
        priceTier,
        isFree: Boolean(form.isFree),
        lat: coords[1],
        lng: coords[0],
        addressStructured: {},
        openingHours: form.openingHours ? { default: form.openingHours } : undefined,
        weeklySchedule,
        tags: splitList(form.tags),
        menu: splitList(form.menu),
        menuItems,
        greenInitiatives: splitList(form.greenInitiatives),
        verificationDocuments: [licenseDoc, ownerIdDoc].filter(Boolean),
        storefrontPhotoUrl: storefrontUrl || undefined,
        menuCatalogFileUrl: menuFileUrl || undefined,
        menuCatalogText,
        localSourcingNote,
        ecoOptions,
        carbonWalkIncentive,
        socialLinks,
        notifyBuddyMeetups,
        notifyFlashDeals,
        autoVerifiedLocal: true,
        autoVerificationNotes: verification?.summary || 'Verified by onboarding AI'
      });
      try {
        await api.post(`/businesses/${data._id}/menu/publish`, { menuItems });
      } catch {}
      setBusiness(data);
      setCreatingNewBusiness(false);
      updateUser({ businessId: data._id });
      setActiveBusinessId(String(data._id));
      await loadOwnedBusinesses();
      addToast({ type: 'success', title: 'Business registered', message: 'Your listing is live. You can request Red Pin verification from the dashboard.' });
    } catch (err) {
      console.error(err);
      addToast({
        type: 'error',
        title: 'Registration failed',
        message: err.response?.data?.error || err.message || 'Could not register business.'
      });
    }
  };

  const createOffer = async (e) => {
    e.preventDefault();
    setOfferError('');
    try {
      await api.post('/offers', {
        businessId: business._id,
        title: offerForm.title,
        description: offerForm.description,
        offerPrice: Number(offerForm.offerPrice),
        originalPrice: offerForm.originalPrice ? Number(offerForm.originalPrice) : undefined,
        validUntil: offerForm.validUntil ? new Date(offerForm.validUntil) : undefined,
        durationMinutes: Number(offerForm.durationMinutes) || 30,
      });
      const { data } = await api.get(`/offers/business/${business._id}`);
      setOffers(data);
      setShowOffer(false);
      setOfferForm({ title: '', description: '', offerPrice: '', originalPrice: '', validUntil: '', durationMinutes: 30 });
      if (analytics) setAnalytics((a) => ({ ...a, offerClicks: (a.offerClicks || 0) + 1 }));
    } catch (err) {
      setOfferError(err.response?.data?.error || 'Failed to create offer');
    }
  };

  const updateCrowd = async (level) => {
    try {
      await api.put(`/businesses/${business._id}`, { crowdLevel: level });
      setBusiness((b) => ({ ...b, crowdLevel: level }));
    } catch (err) {
      console.error(err);
    }
  };

  const publishMenuPdf = async () => {
    if (!business?._id || menuPublishBusy) return;
    const items = menuRows
      .map((r) => ({
        name: String(r.name || '').trim(),
        price: parseFloat(String(r.price || '').replace(/,/g, '')),
        description: String(r.description || '').trim().slice(0, 300)
      }))
      .filter((r) => r.name && Number.isFinite(r.price) && r.price >= 0);
    if (!items.length) {
      addToast({
        type: 'error',
        title: 'Menu incomplete',
        message: 'Add at least one item with a name and a valid price in INR.'
      });
      return;
    }
    setMenuPublishBusy(true);
    try {
      const { data } = await api.post(`/businesses/${business._id}/menu/publish`, { menuItems: items });
      setBusiness(data.business);
      if (Array.isArray(data.business?.menuItems) && data.business.menuItems.length > 0) {
        setMenuRows(
          data.business.menuItems.map((m) => ({
            name: m.name || '',
            price: m.price != null ? String(m.price) : '',
            description: m.description || ''
          }))
        );
      }
      addToast({
        type: 'success',
        title: 'Menu published',
        message: data.aiTagline
          ? 'PDF ready with an AI subtitle — explorers can open it from your map pin.'
          : 'PDF menu is live on your map pin (add GEMINI_API_KEY for an AI subtitle on the PDF).'
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Could not publish menu',
        message: err.response?.data?.error || err.message || 'Try again.'
      });
    } finally {
      setMenuPublishBusy(false);
    }
  };

  const deleteCurrentBusiness = async () => {
    if (!business?._id || deletingBusiness) return;
    const confirmed = window.confirm('Delete this business permanently? This will remove offers and analytics for this business.');
    if (!confirmed) return;
    setDeleteError('');
    setDeletingBusiness(true);
    try {
      await api.delete(`/businesses/${business._id}`);
      setCreatingNewBusiness(false);
      const rows = await loadOwnedBusinesses();
      if (rows.length > 0) {
        const nextId = String(rows[0]._id);
        setActiveBusinessId(nextId);
        updateUser({ businessId: nextId });
      } else {
        setBusiness(null);
        setAnalytics(null);
        setOffers([]);
        setActiveBusinessId(null);
        updateUser({ businessId: null });
      }
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete business');
    } finally {
      setDeletingBusiness(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-8 goout-animate-in">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-7 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-700">Merchant Console</p>
            <h1 className="mt-2 font-display font-bold text-2xl md:text-4xl bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
              Merchant dashboard
            </h1>
            <p className="text-sm text-slate-600 mt-2 max-w-xl">Offers, crowd signals, verification, and storefront controls in one command center.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </span>
            {activeBusinessId && !creatingNewBusiness && (
              <button
                type="button"
                onClick={() => {
                  setCreatingNewBusiness(true);
                  resetNewBusinessForm();
                }}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition">
                + Create new business
              </button>
            )}
          </div>
        </div>
      </div>

      {business && !creatingNewBusiness && (
        <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Current business:</span>{' '}
                {business.name} · {business.category}
              </p>
              {ownedBusinesses.length > 1 &&
              <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Switch business</span>
                  <select
                  value={String(activeBusinessId || '')}
                  onChange={async (e) => {
                    const nextId = String(e.target.value || '');
                    if (!nextId || nextId === String(activeBusinessId || '')) return;
                    try {
                      await api.post(`/businesses/switch/${nextId}`);
                      setActiveBusinessId(nextId);
                      updateUser({ businessId: nextId });
                      addToast({ type: 'success', title: 'Business switched', message: 'Dashboard updated to selected business.' });
                    } catch (err) {
                      addToast({ type: 'error', title: 'Switch failed', message: err.response?.data?.error || 'Could not switch business.' });
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white shadow-sm">
                    {ownedBusinesses.map((b) =>
                  <option key={b._id} value={String(b._id)}>
                        {(b.mapDisplayName || b.name || 'Business').slice(0, 60)}
                      </option>
                  )}
                  </select>
                </div>
              }
            </div>
            <div className="flex items-center gap-2">
              {business?.localVerification?.redPin ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">Red Pin Verified</span>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { data } = await api.patch(`/businesses/${business._id}/verify-local`);
                      setBusiness((b) => ({ ...b, localVerification: data.localVerification }));
                      addToast({ type: 'success', title: 'Verification update', message: data.message || 'Verification request submitted.' });
                    } catch (e) {
                      addToast({ type: 'error', title: 'Verification failed', message: e.response?.data?.error || 'Could not verify local status.' });
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl text-sm border border-red-200 text-red-700 hover:bg-red-50"
                >
                  Request Red Pin
                </button>
              )}
              <button
                type="button"
                onClick={deleteCurrentBusiness}
                disabled={deletingBusiness}
                className="px-3 py-1.5 rounded-xl text-sm text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-60"
              >
                {deletingBusiness ? 'Deleting...' : 'Delete business'}
              </button>
            </div>
          </div>
          {deleteError && <p className="text-xs text-red-600 mt-2">{deleteError}</p>}
        </div>
      )}
      {business && !creatingNewBusiness && (
        <div className="grid gap-4 md:grid-cols-12 goout-bento-grid">
          <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-emerald-50 p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Live flash deals</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{offers.length}</p>
          </div>
          <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Profile views</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{analytics?.profileViews || 0}</p>
          </div>
          <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Verification</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {business?.localVerification?.redPin ? 'Red Pin active' : 'Standard listing'}
            </p>
          </div>
        </div>
      )}

      {showRegistrationForm && (
        <div className="mx-auto w-full max-w-6xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <h2 className="font-display font-semibold text-lg">
              {creatingNewBusiness ? 'Register another business' : 'Register your business'}
            </h2>
            {creatingNewBusiness && merchantBusinessId && (
              <button
                type="button"
                onClick={() => {
                  setCreatingNewBusiness(false);
                  resetNewBusinessForm();
                }}
                className="text-sm text-slate-600 hover:text-slate-800 underline"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-slate-600 text-sm mb-6">
            Complete only the essentials to go live quickly. You can edit advanced profile details later from Profile.
          </p>

          <div className="mb-6 grid gap-4 xl:grid-cols-12">
          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3 shadow-sm xl:col-span-5">
              <h3 className="text-sm font-semibold text-slate-900">1 · AI-driven smart onboarding</h3>
              <label className="text-xs text-slate-600 block">Business narrative (natural language)</label>
              <textarea
                value={aiBlurb}
                onChange={(e) => setAiBlurb(e.target.value)}
                rows={5}
                placeholder='e.g. "We are a small vegan bakery on 5th street, open 9–5, sourdough and cinnamon rolls, bright casual vibe."'
                className="goout-input min-h-[120px] text-sm"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={fillWithAi}
                  disabled={aiBusy}
                  className="px-3 py-1.5 rounded-lg bg-goout-green text-white text-sm font-medium disabled:opacity-60"
                >
                  {aiBusy ? 'Working…' : 'Fill with AI'}
                </button>
              </div>
              {aiError && <p className="text-xs text-red-600">{aiError}</p>}
              {aiPreview && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                  <p className="text-xs font-medium text-emerald-900">AI metadata preview (read-only — confirm below before submitting)</p>
                  <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-emerald-700/80">Name</dt>
                      <dd className="font-medium text-emerald-900">{aiPreview.name || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-emerald-700/80">Category</dt>
                      <dd className="font-medium text-emerald-900">{aiPreview.category || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-emerald-700/80">Vibe</dt>
                      <dd className="font-medium text-emerald-900">{aiPreview.vibe || '—'}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>

          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3 shadow-sm xl:col-span-7">
            <h3 className="text-sm font-semibold text-slate-900">2 · Identity and verification (Red Pin layer)</h3>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Official business name (map markers)</label>
              <input
                type="text"
                value={mapDisplayName}
                onChange={(e) => setMapDisplayName(e.target.value)}
                placeholder="Shown on the map (e.g. storefront sign)"
                className="goout-input text-sm"
              />
              <p className="text-[11px] text-slate-500 mt-1">Legal / listing name is below; this label is what explorers see on the pin.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">Business license / GST / registration proof (photo or PDF)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={uploadBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploadBusy(true);
                    try {
                      const url = await uploadMerchantAsset(file);
                      setLicenseDoc({ url, label: file.name });
                      addToast({ type: 'success', title: 'License uploaded', message: 'Business proof attached.' });
                    } catch (err) {
                      addToast({ type: 'error', title: 'Upload failed', message: err.response?.data?.error || err.message });
                    } finally {
                      setUploadBusy(false);
                    }
                  }}
                  className="block w-full text-sm text-slate-700"
                />
                {licenseDoc?.url && <a href={licenseDoc.url} target="_blank" rel="noreferrer" className="text-xs text-goout-green underline">View license proof</a>}
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Owner government ID (PAN/Aadhaar)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={uploadBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploadBusy(true);
                    try {
                      const url = await uploadMerchantAsset(file);
                      setOwnerIdDoc({ url, label: file.name });
                      addToast({ type: 'success', title: 'Owner ID uploaded', message: 'Identity proof attached.' });
                    } catch (err) {
                      addToast({ type: 'error', title: 'Upload failed', message: err.response?.data?.error || err.message });
                    } finally {
                      setUploadBusy(false);
                    }
                  }}
                  className="block w-full text-sm text-slate-700"
                />
                {ownerIdDoc?.url && <a href={ownerIdDoc.url} target="_blank" rel="noreferrer" className="text-xs text-goout-green underline">View owner ID</a>}
              </div>
            </div>
            {verificationTemplates && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 space-y-2">
                <p className="font-semibold text-emerald-900">Verification templates that pass OCR checks</p>
                <div>
                  <p className="font-medium">{verificationTemplates?.businessCertificate?.title || 'Business certificate'}</p>
                  <ul className="list-disc ml-4 mt-1 space-y-0.5">
                    {(verificationTemplates?.businessCertificate?.requiredFields || []).map((x) => (
                      <li key={`bc-${x}`}>{x}</li>
                    ))}
                  </ul>
                  {(verificationTemplates?.businessCertificate?.sampleTemplateText || []).length > 0 && (
                    <pre className="mt-2 whitespace-pre-wrap rounded border border-emerald-300/40 bg-white p-2 text-[11px] text-emerald-900">
                      {(verificationTemplates?.businessCertificate?.sampleTemplateText || []).join('\n')}
                    </pre>
                  )}
                </div>
                <div>
                  <p className="font-medium">{verificationTemplates?.aadhaar?.title || 'Aadhaar'}</p>
                  <ul className="list-disc ml-4 mt-1 space-y-0.5">
                    {(verificationTemplates?.aadhaar?.requiredFields || []).map((x) => (
                      <li key={`ad-${x}`}>{x}</li>
                    ))}
                  </ul>
                  {(verificationTemplates?.aadhaar?.sampleTemplateText || []).length > 0 && (
                    <pre className="mt-2 whitespace-pre-wrap rounded border border-emerald-300/40 bg-white p-2 text-[11px] text-emerald-900">
                      {(verificationTemplates?.aadhaar?.sampleTemplateText || []).join('\n')}
                    </pre>
                  )}
                </div>
              </div>
            )}
            {verificationSummary && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${
                verificationSummary?.isVerified ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
              }`}>
                <p className="font-semibold">{verificationSummary.summary || (verificationSummary?.isVerified ? 'Verified' : 'Verification failed')}</p>
                <ul className="mt-2 space-y-1">
                  {verificationIssueRows(verificationSummary).map((row) => (
                    <li key={row.key}>
                      {row.ok ? 'PASS' : 'FAIL'} · {row.label}
                      {!row.ok && row.reason ? ` — ${row.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">Primary mobile (OTP / alerts)</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="goout-input text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Owner contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="goout-input text-sm"
                  required
                />
              </div>
            </div>
          </div>
          </div>

          <div className="mb-6 p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">3 · Geospatial and map</h3>
            <p className="text-xs text-slate-600">Pin your exact shop entrance (interactive map). You can change it anytime before submit.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={takeCurrentLocation} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
                Refresh GPS
              </button>
            </div>
            <ManualLocationPicker
              value={suggestedLocation}
              onPick={(loc) => {
                setSuggestedLocation(loc);
                setLocationStatus('Pin updated.');
                addToast({ type: 'success', title: 'Location set', message: 'Pin placed on the map.' });
              }}
              height={260}
            />
            {locationStatus && <p className="text-xs text-slate-600">{locationStatus}</p>}
            {suggestedLocation && (
              <p className="text-xs text-goout-green">
                Coordinates: {suggestedLocation.lat.toFixed(5)}, {suggestedLocation.lng.toFixed(5)}
              </p>
            )}
            <div>
              <label className="text-xs text-slate-600 block mb-1">Storefront photo (helps people find you)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadBusy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setUploadBusy(true);
                  try {
                    const url = await uploadMerchantAsset(file);
                    setStorefrontUrl(url);
                    addToast({ type: 'success', title: 'Photo uploaded', message: 'Storefront image saved.' });
                  } catch (err) {
                    addToast({ type: 'error', title: 'Upload failed', message: err.response?.data?.error || err.message });
                  } finally {
                    setUploadBusy(false);
                  }
                }}
                className="block w-full text-sm text-slate-700"
              />
              {storefrontUrl && (
                <img src={storefrontUrl} alt="Storefront" className="mt-2 max-h-36 rounded-lg border border-emerald-500/30 object-cover" />
              )}
            </div>
          </div>

          <form onSubmit={registerBusiness} className="space-y-6">
            <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">4 · Business essentials</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-600 block mb-1">Legal / listing business name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="goout-input"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Primary category</label>
                  <select
                    value={primaryCategory}
                    onChange={(e) => setPrimaryCategory(e.target.value)}
                    className="goout-input text-sm"
                  >
                    {PRIMARY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Price tier</label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setPriceTier(t)}
                        className={`px-3 py-1.5 rounded-lg text-sm border ${
                          priceTier === t ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold' : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {'₹'.repeat(t)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {primaryCategory === 'Other' && (
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Describe your category"
                  className="goout-input text-sm"
                  required
                />
              )}
              <div>
                <label className="text-xs text-slate-600 block mb-1">Customer-facing vibe</label>
                <input
                  type="text"
                  value={vibe}
                  onChange={(e) => setVibe(e.target.value)}
                  placeholder="Short atmosphere line"
                  className="goout-input text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="goout-input"
                  rows={3}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Primary mobile</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="goout-input text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Owner contact email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="goout-input text-sm"
                    required
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.isFree)}
                  onChange={(e) => setForm((f) => ({ ...f, isFree: e.target.checked }))}
                />
                Free entry / no typical paid visit
              </label>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">5 · Menu essentials (required)</h3>
              <p className="text-xs text-slate-600">
                Add at least one menu item with INR price. Average price is auto-derived and menu PDF is generated after registration.
              </p>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                {menuRows.map((row, idx) => (
                  <div key={`onboard-${idx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => setMenuRows((rows) => rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                      placeholder="Item"
                      className="sm:col-span-6 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => setMenuRows((rows) => rows.map((r, i) => (i === idx ? { ...r, price: e.target.value } : r)))}
                      placeholder="₹ Price"
                      className="sm:col-span-3 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
                    />
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => setMenuRows((rows) => rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))}
                      placeholder="Note"
                      className="sm:col-span-3 px-2 py-1.5 border border-slate-200 rounded text-sm bg-white text-slate-900"
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMenuRows((rows) => [...rows, { name: '', price: '', description: '' }])} className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-700 hover:bg-slate-50">
                    + Add item
                  </button>
                  <button type="button" onClick={() => setMenuRows([{ name: '', price: '', description: '' }])} className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-700 hover:bg-slate-50">
                    Reset
                  </button>
                </div>
                <div className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  Preview avg price (derived): ₹{averagePriceFromItems(normalizeMenuRows(menuRows))}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={menuPreviewConfirmed} onChange={(e) => setMenuPreviewConfirmed(e.target.checked)} />
                  I reviewed the menu preview.
                </label>
              </div>
            </div>

            <button type="submit" className="px-5 py-2.5 bg-goout-green text-white rounded-lg font-medium">
              Register business
            </button>
          </form>
        </div>
      )}

      {business && !creatingNewBusiness && (
        <>
          <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/40 p-6 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display font-semibold text-lg text-slate-900">Merchant profile studio</h2>
                <p className="text-xs text-slate-600 mt-0.5">Control how explorers discover your storefront on the map.</p>
              </div>
              <button type="button" onClick={() => { setEditProfile(!editProfile); if (!editProfile) setEditTags((business.tags || []).join(', ')); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition">
                {editProfile ? 'Cancel' : 'Edit tags'}
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Category: {business?.category || 'N/A'}
              </span>
              <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                Rating: {Number.isFinite(Number(business?.rating)) ? Number(business.rating).toFixed(1) : 'N/A'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                Tags: {(business?.tags || []).length}
              </span>
            </div>
            {editProfile ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">Add tags so users can find you (e.g. Quiet, FastWiFi, VeganFriendly).</p>
                <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Comma-separated tags" className="w-full px-4 py-2 border rounded-lg" />
                <button type="button" onClick={async () => { try { await api.put(`/businesses/${business._id}`, { tags: editTags.split(',').map((s) => s.trim()).filter(Boolean) }); setBusiness((b) => ({ ...b, tags: editTags.split(',').map((s) => s.trim()).filter(Boolean) })); setEditProfile(false); } catch (e) { console.error(e); } }} className="px-4 py-2 bg-goout-green text-white rounded-lg text-sm">Save tags</button>
              </div>
            ) : (
              <p className="text-slate-600 text-sm">Tags: {(business.tags || []).length ? (business.tags || []).join(', ') : 'None — click Edit tags to add.'}</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/30 p-6 md:p-7 space-y-4 shadow-lg">
            <div>
              <h2 className="font-display font-semibold text-lg text-slate-900">Customer menu (PDF)</h2>
              <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                List items with prices in INR. When you save, we ask our AI for a short welcome line on the PDF, then build a printable menu with your business name.
                Explorers see <strong className="text-slate-800">View menu</strong> on your map pin and open the PDF in a new tab.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  Auto PDF generation
                </span>
                <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Explorer map integration
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {menuRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                  <label className="sm:col-span-5 block">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Item</span>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => setMenuRows((rows) => rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                      placeholder="e.g. Masala dosa"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Price ₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => setMenuRows((rows) => rows.map((r, i) => (i === idx ? { ...r, price: e.target.value } : r)))}
                      placeholder="120"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </label>
                  <label className="sm:col-span-4 block">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note (optional)</span>
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => setMenuRows((rows) => rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))}
                      placeholder="Vegan, spicy…"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </label>
                  <div className="sm:col-span-1 flex justify-end sm:justify-center pb-1">
                    <button
                      type="button"
                      disabled={menuRows.length <= 1}
                      onClick={() => setMenuRows((rows) => rows.filter((_, i) => i !== idx))}
                      className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded-lg hover:bg-red-50">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMenuRows((rows) => [...rows, { name: '', price: '', description: '' }])}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
                + Add row
              </button>
              <button
                type="button"
                onClick={publishMenuPdf}
                disabled={menuPublishBusy}
                className="goout-btn-primary text-sm py-2 px-5">
                {menuPublishBusy ? 'Generating PDF…' : 'Save & generate menu PDF'}
              </button>
            </div>
            {business.menuCatalogFileUrl ? (
              <p className="text-sm text-slate-600">
                Current PDF:{' '}
                <a
                  href={getAssetUrl(business.menuCatalogFileUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-goout-green font-semibold underline hover:text-emerald-700">
                  Open preview
                </a>
              </p>
            ) : (
              <p className="text-xs text-slate-500">No PDF yet — save once to create the file explorers will open.</p>
            )}
          </div>

          <MerchantAnalyticsPanel analytics={analytics} business={business} onCrowdChange={updateCrowd} />

          <div className="rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display font-semibold text-lg">Live Offer Feed (Flash Deals)</h2>
              <button onClick={() => setShowOffer(true)} className="px-4 py-2 bg-goout-green text-white rounded-xl font-medium text-sm hover:bg-goout-accent transition">
                + New Flash Deal
              </button>
            </div>
            {showOffer && (
              <form onSubmit={createOffer} className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                {offerError && <p className="text-red-600 text-sm">{offerError}</p>}
                <input type="text" placeholder="Title (e.g. 50% off for next 30 min)" value={offerForm.title} onChange={(e) => setOfferForm((f) => ({ ...f, title: e.target.value }))} required
                  className="w-full px-4 py-2 border rounded-lg" />
                <input type="text" placeholder="Description" value={offerForm.description} onChange={(e) => setOfferForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-4 py-2 border rounded-lg" />
                <div className="flex gap-2">
                  <input type="number" placeholder="Offer price ₹" value={offerForm.offerPrice} onChange={(e) => setOfferForm((f) => ({ ...f, offerPrice: e.target.value }))} required
                    className="flex-1 px-4 py-2 border rounded-lg" />
                  <input type="number" placeholder="Original ₹" value={offerForm.originalPrice} onChange={(e) => setOfferForm((f) => ({ ...f, originalPrice: e.target.value }))}
                    className="flex-1 px-4 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Duration (deal auto-expires)</label>
                  <select value={offerForm.durationMinutes} onChange={(e) => setOfferForm((f) => ({ ...f, durationMinutes: e.target.value }))} className="w-full px-4 py-2 border rounded-lg">
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>
                <p className="text-xs text-slate-500">Or set exact end time: <input type="datetime-local" value={offerForm.validUntil} onChange={(e) => setOfferForm((f) => ({ ...f, validUntil: e.target.value }))} className="px-2 py-1 border rounded" /></p>
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 bg-goout-green text-white rounded-xl text-sm hover:bg-goout-accent transition">Create Flash Deal</button>
                  <button type="button" onClick={() => setShowOffer(false)} className="px-4 py-2 border rounded-xl text-sm">Cancel</button>
                </div>
              </form>
            )}
            <div className="space-y-2">
              {offers.length === 0 ? (
                <p className="text-slate-500 text-sm">No active offers.</p>
              ) : (
                offers.map((o) => (
                  <div key={o._id} className="flex justify-between items-center p-3 bg-goout-mint/80 border border-emerald-100 rounded-xl">
                    <div>
                      <p className="font-medium">{o.title}</p>
                      <p className="text-sm text-slate-600">₹{o.offerPrice} {o.originalPrice && <span className="line-through">₹{o.originalPrice}</span>} · Valid till {new Date(o.validUntil).toLocaleString()}</p>
                    </div>
                    <button type="button" onClick={async () => { try { await api.patch(`/offers/${o._id}/stop`); setOffers((prev) => prev.filter((x) => x._id !== o._id)); } catch (e) { console.error(e); } }} className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200">Stop Deal</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
