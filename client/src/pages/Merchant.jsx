import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ManualLocationPicker from '../components/explorer/ManualLocationPicker';

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

async function uploadMerchantAsset(file) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/uploads/merchant-asset', fd);
  return data.url;
}

export default function Merchant() {
  const { user, updateUser } = useAuth();
  const { addToast } = useToast();
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
  const [verificationDocs, setVerificationDocs] = useState([]);
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

  const merchantBusinessId = getMerchantBusinessId(user);
  const showRegistrationForm = !merchantBusinessId || creatingNewBusiness;

  useEffect(() => {
    if (!merchantBusinessId || creatingNewBusiness) {
      if (!merchantBusinessId) {
        setBusiness(null);
        setAnalytics(null);
        setOffers([]);
        setCreatingNewBusiness(false);
      }
      return;
    }
    const bid = merchantBusinessId.toString();
    api.get(`/businesses/${bid}`).then(({ data }) => { setBusiness(data); setEditTags((data.tags || []).join(', ')); }).catch(console.error);
    api.get(`/businesses/${bid}/analytics`).then(({ data }) => setAnalytics(data)).catch(console.error);
    api.get(`/offers/business/${bid}`).then(({ data }) => setOffers(data)).catch(console.error);
  }, [merchantBusinessId, creatingNewBusiness]);

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
    setVerificationDocs([]);
    setStorefrontUrl('');
    setMenuFileUrl('');
    setEcoOptions({ plasticFree: false, solarPowered: false, zeroWaste: false });
    setLocalSourcingNote('');
    setCarbonWalkIncentive(false);
    setSocialLinks({ website: '', instagram: '', facebook: '' });
    setMenuCatalogText('');
    setNotifyBuddyMeetups(true);
    setNotifyFlashDeals(true);
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
      const coords = [suggestedLocation.lng, suggestedLocation.lat];
      const splitList = (s) => String(s || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const category = primaryCategory === 'Other' ? (form.category || 'Other') : primaryCategory;
      const { data } = await api.post('/businesses', {
        name: form.name,
        mapDisplayName: mapDisplayName.trim() || form.name,
        description: form.description,
        category,
        vibe: vibe.trim(),
        phone: form.phone,
        contactEmail: contactEmail.trim(),
        avgPrice: form.avgPrice,
        priceTier,
        isFree: Boolean(form.isFree),
        lat: coords[1],
        lng: coords[0],
        addressStructured,
        openingHours: form.openingHours ? { default: form.openingHours } : undefined,
        weeklySchedule,
        tags: splitList(form.tags),
        menu: splitList(form.menu),
        greenInitiatives: splitList(form.greenInitiatives),
        verificationDocuments: verificationDocs,
        storefrontPhotoUrl: storefrontUrl || undefined,
        menuCatalogFileUrl: menuFileUrl || undefined,
        menuCatalogText,
        localSourcingNote,
        ecoOptions,
        carbonWalkIncentive,
        socialLinks,
        notifyBuddyMeetups,
        notifyFlashDeals
      });
      setBusiness(data);
      setCreatingNewBusiness(false);
      updateUser({ businessId: data._id });
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

  const deleteCurrentBusiness = async () => {
    if (!business?._id || deletingBusiness) return;
    const confirmed = window.confirm('Delete this business permanently? This will remove offers and analytics for this business.');
    if (!confirmed) return;
    setDeleteError('');
    setDeletingBusiness(true);
    try {
      await api.delete(`/businesses/${business._id}`);
      setBusiness(null);
      setAnalytics(null);
      setOffers([]);
      setCreatingNewBusiness(false);
      updateUser({ businessId: null });
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete business');
    } finally {
      setDeletingBusiness(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6 goout-animate-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display font-bold text-2xl text-goout-dark">Merchant Dashboard</h1>
        {merchantBusinessId && !creatingNewBusiness && (
          <button
            type="button"
            onClick={() => {
              setCreatingNewBusiness(true);
              resetNewBusinessForm();
            }}
            className="px-4 py-2 rounded-xl border border-goout-green text-goout-green font-medium hover:bg-goout-mint transition"
          >
            + Create new business
          </button>
        )}
      </div>

      {business && !creatingNewBusiness && (
        <div className="goout-soft-card rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">Current business:</span>{' '}
              {business.name} · {business.category}
            </p>
            <div className="flex items-center gap-2">
              {business?.localVerification?.redPin ? (
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Red Pin Verified</span>
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
                  className="px-3 py-1.5 rounded-lg text-sm border border-red-200 text-red-700 hover:bg-red-50"
                >
                  Request Red Pin
                </button>
              )}
              <button
                type="button"
                onClick={deleteCurrentBusiness}
                disabled={deletingBusiness}
                className="px-3 py-1.5 rounded-lg text-sm text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-60"
              >
                {deletingBusiness ? 'Deleting...' : 'Delete business'}
              </button>
            </div>
          </div>
          {deleteError && <p className="text-xs text-red-600 mt-2">{deleteError}</p>}
        </div>
      )}

      {showRegistrationForm && (
        <div className="goout-surface rounded-2xl p-6">
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
                className="text-sm text-slate-600 hover:text-slate-900 underline"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-slate-600 text-sm mb-6">
            Complete each section. Your map pin refines the exact entrance; structured address helps discovery and verification.
          </p>

          <div className="mb-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">1 · AI-driven smart onboarding</h3>
            <label className="text-xs text-slate-600 block">Business narrative (natural language)</label>
            <textarea
              value={aiBlurb}
              onChange={(e) => setAiBlurb(e.target.value)}
              rows={5}
              placeholder='e.g. "We are a small vegan bakery on 5th street, open 9–5, sourdough and cinnamon rolls, bright casual vibe."'
              className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm bg-white min-h-[120px]"
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
              <div className="rounded-lg border border-emerald-300/60 bg-white/90 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-700">AI metadata preview (read-only — confirm below before submitting)</p>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Name</dt>
                    <dd className="font-medium text-slate-900">{aiPreview.name || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Category</dt>
                    <dd className="font-medium text-slate-900">{aiPreview.category || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Vibe</dt>
                    <dd className="font-medium text-slate-900">{aiPreview.vibe || '—'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>

          <div className="mb-6 p-4 rounded-xl border border-red-100 bg-red-50/40 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">2 · Identity and verification (Red Pin layer)</h3>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Official business name (map markers)</label>
              <input
                type="text"
                value={mapDisplayName}
                onChange={(e) => setMapDisplayName(e.target.value)}
                placeholder="Shown on the map (e.g. storefront sign)"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
              />
              <p className="text-[11px] text-slate-500 mt-1">Legal / listing name is below; this label is what explorers see on the pin.</p>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Verification uploads (license, tax ID, or storefront photo)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={uploadBusy || verificationDocs.length >= 4}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setUploadBusy(true);
                  try {
                    const url = await uploadMerchantAsset(file);
                    setVerificationDocs((d) => [...d, { url, label: file.name }]);
                    addToast({ type: 'success', title: 'File uploaded', message: 'Attached to your application.' });
                  } catch (err) {
                    addToast({ type: 'error', title: 'Upload failed', message: err.response?.data?.error || err.message });
                  } finally {
                    setUploadBusy(false);
                  }
                }}
                className="block w-full text-sm text-slate-600"
              />
              {verificationDocs.length > 0 && (
                <ul className="mt-2 text-xs text-slate-600 space-y-1">
                  {verificationDocs.map((d) => (
                    <li key={d.url}>
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-goout-green underline">
                        {d.label || 'Document'}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Primary mobile (OTP / alerts)</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Owner contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                  required
                />
              </div>
            </div>
          </div>

          <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">3 · Geospatial and map</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-500 block mb-1">Street</label>
                <input
                  type="text"
                  value={addressStructured.street}
                  onChange={(e) => setAddressStructured((a) => ({ ...a, street: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Neighborhood</label>
                <input
                  type="text"
                  value={addressStructured.neighborhood}
                  onChange={(e) => setAddressStructured((a) => ({ ...a, neighborhood: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">City</label>
                <input
                  type="text"
                  value={addressStructured.city}
                  onChange={(e) => setAddressStructured((a) => ({ ...a, city: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Postal code</label>
                <input
                  type="text"
                  value={addressStructured.postalCode}
                  onChange={(e) => setAddressStructured((a) => ({ ...a, postalCode: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
            </div>
            <p className="text-xs text-slate-600">Interactive pin — drag or click on the map to your shop entrance.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={takeCurrentLocation} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm">
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
              <label className="text-xs text-slate-500 block mb-1">Storefront photo (helps people find you)</label>
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
                className="block w-full text-sm text-slate-600"
              />
              {storefrontUrl && (
                <img src={storefrontUrl} alt="Storefront" className="mt-2 max-h-36 rounded-lg border border-slate-200 object-cover" />
              )}
            </div>
          </div>

          <form onSubmit={registerBusiness} className="space-y-6">
            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">4 · Operations and budget metadata</h3>
              <div>
                <label className="text-xs text-slate-500 block mb-2">Operating hours (7-day)</label>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {DAY_ORDER.map((day) => (
                    <div key={day} className="flex flex-wrap items-center gap-2 text-sm bg-slate-50 rounded-lg px-2 py-1.5">
                      <span className="w-10 font-medium text-slate-700">{DAY_LABELS[day]}</span>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={weeklySchedule[day]?.closed}
                          onChange={(e) => setWeeklySchedule((w) => ({
                            ...w,
                            [day]: { ...w[day], closed: e.target.checked }
                          }))}
                        />
                        Closed
                      </label>
                      {!weeklySchedule[day]?.closed && (
                        <>
                          <input
                            type="time"
                            value={weeklySchedule[day]?.open || '09:00'}
                            onChange={(e) => setWeeklySchedule((w) => ({
                              ...w,
                              [day]: { ...w[day], open: e.target.value }
                            }))}
                            className="border border-slate-200 rounded px-1 py-0.5 text-xs"
                          />
                          <span className="text-slate-400">–</span>
                          <input
                            type="time"
                            value={weeklySchedule[day]?.close || '17:00'}
                            onChange={(e) => setWeeklySchedule((w) => ({
                              ...w,
                              [day]: { ...w[day], close: e.target.value }
                            }))}
                            className="border border-slate-200 rounded px-1 py-0.5 text-xs"
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">Optional one-line note for AI (legacy field):</p>
                <input
                  type="text"
                  value={form.openingHours}
                  onChange={(e) => setForm((f) => ({ ...f, openingHours: e.target.value }))}
                  placeholder="e.g. Open later on Fridays"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Price tier (Budget Planner)</label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPriceTier(t)}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${
                        priceTier === t ? 'border-goout-green bg-goout-mint text-goout-green font-semibold' : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      {'$'.repeat(t)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Primary category</label>
                <select
                  value={primaryCategory}
                  onChange={(e) => setPrimaryCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  {PRIMARY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {primaryCategory === 'Other' && (
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="Describe your category"
                    className="w-full mt-2 px-4 py-2 border border-slate-200 rounded-lg text-sm"
                    required
                  />
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-green-100 bg-green-50/30 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">5 · Sustainability and green indicators</h3>
              <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ecoOptions.plasticFree}
                    onChange={(e) => setEcoOptions((o) => ({ ...o, plasticFree: e.target.checked }))}
                  />
                  Plastic-free
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ecoOptions.solarPowered}
                    onChange={(e) => setEcoOptions((o) => ({ ...o, solarPowered: e.target.checked }))}
                  />
                  Solar powered
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ecoOptions.zeroWaste}
                    onChange={(e) => setEcoOptions((o) => ({ ...o, zeroWaste: e.target.checked }))}
                  />
                  Zero-waste
                </label>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Local sourcing / handmade note</label>
                <textarea
                  value={localSourcingNote}
                  onChange={(e) => setLocalSourcingNote(e.target.value)}
                  rows={2}
                  placeholder="Local farms, in-house baking, handmade textiles…"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={carbonWalkIncentive}
                  onChange={(e) => setCarbonWalkIncentive(e.target.checked)}
                />
                We offer incentives for walkers / cyclists
              </label>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">6 · Digital presence and notifications</h3>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Website</label>
                  <input
                    type="url"
                    value={socialLinks.website}
                    onChange={(e) => setSocialLinks((s) => ({ ...s, website: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    placeholder="https://"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Instagram</label>
                  <input
                    type="text"
                    value={socialLinks.instagram}
                    onChange={(e) => setSocialLinks((s) => ({ ...s, instagram: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Facebook</label>
                  <input
                    type="text"
                    value={socialLinks.facebook}
                    onChange={(e) => setSocialLinks((s) => ({ ...s, facebook: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Menu / catalog (text)</label>
                <textarea
                  value={menuCatalogText}
                  onChange={(e) => setMenuCatalogText(e.target.value)}
                  rows={3}
                  placeholder="Top items so AI can answer “who sells sourdough?”"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Menu / catalog file (PDF)</label>
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={uploadBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploadBusy(true);
                    try {
                      const url = await uploadMerchantAsset(file);
                      setMenuFileUrl(url);
                      addToast({ type: 'success', title: 'Catalog uploaded', message: 'PDF linked to your profile.' });
                    } catch (err) {
                      addToast({ type: 'error', title: 'Upload failed', message: err.response?.data?.error || err.message });
                    } finally {
                      setUploadBusy(false);
                    }
                  }}
                  className="block w-full text-sm text-slate-600"
                />
                {menuFileUrl && (
                  <a href={menuFileUrl} target="_blank" rel="noreferrer" className="text-xs text-goout-green underline mt-1 inline-block">
                    View uploaded PDF
                  </a>
                )}
              </div>
              <p className="text-xs font-medium text-slate-700">Socket.io alert preferences</p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={notifyBuddyMeetups} onChange={(e) => setNotifyBuddyMeetups(e.target.checked)} />
                GoOut Buddy meetup alerts
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={notifyFlashDeals} onChange={(e) => setNotifyFlashDeals(e.target.checked)} />
                Flash deal reminders
              </label>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Listing details</h3>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Legal / listing business name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Customer-facing vibe (editable)</label>
                <input
                  type="text"
                  value={vibe}
                  onChange={(e) => setVibe(e.target.value)}
                  placeholder="Short atmosphere line"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Avg price (₹)</label>
                <input
                  type="number"
                  value={form.avgPrice || ''}
                  onChange={(e) => setForm((f) => ({ ...f, avgPrice: Number(e.target.value) || 0 }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.isFree)}
                  onChange={(e) => setForm((f) => ({ ...f, isFree: e.target.checked }))}
                />
                Free entry / no typical paid visit
              </label>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Signature menu lines (comma-separated)</label>
                <input
                  type="text"
                  value={form.menu}
                  onChange={(e) => setForm((f) => ({ ...f, menu: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Other green initiatives (comma-separated)</label>
                <input
                  type="text"
                  value={form.greenInitiatives}
                  onChange={(e) => setForm((f) => ({ ...f, greenInitiatives: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg"
                />
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
          <div className="goout-surface rounded-2xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display font-semibold text-lg">Profile & semantic tags</h2>
              <button type="button" onClick={() => { setEditProfile(!editProfile); if (!editProfile) setEditTags((business.tags || []).join(', ')); }} className="px-4 py-2 bg-slate-100 rounded-lg text-sm font-medium">
                {editProfile ? 'Cancel' : 'Edit tags'}
              </button>
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

          <div className="grid md:grid-cols-3 gap-6">
            <div className="goout-soft-card rounded-2xl p-6">
              <h3 className="font-display font-semibold mb-2">Profile Views</h3>
              <p className="text-3xl font-bold text-goout-green">{analytics?.profileViews || 0}</p>
            </div>
            <div className="goout-soft-card rounded-2xl p-6">
              <h3 className="font-display font-semibold mb-2">Offer Clicks</h3>
              <p className="text-3xl font-bold text-goout-green">{analytics?.offerClicks || 0}</p>
            </div>
            <div className="goout-soft-card rounded-2xl p-6">
              <h3 className="font-display font-semibold mb-2">Crowd Level</h3>
              <div className="flex gap-2 mt-2">
                {[0, 33, 66, 100].map((l) => (
                  <button
                    key={l}
                    onClick={() => updateCrowd(l)}
                    className={`px-3 py-1 rounded text-sm ${business.crowdLevel === l ? 'bg-goout-green text-white' : 'bg-slate-100'}`}
                  >
                    {l === 0 ? 'Empty' : l === 33 ? 'Quiet' : l === 66 ? 'Busy' : 'Crowded'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="goout-surface rounded-2xl p-6">
            <h2 className="font-display font-semibold text-lg mb-4">Analytics (ROI from GoOut)</h2>
            <p className="text-slate-600 text-sm mb-4">One view/click per visitor per 24h. Data pre-aggregated daily.</p>
            {analytics?.daily?.length > 0 && (
              <div className="mb-6">
                <h3 className="font-medium text-slate-700 mb-2">Last 30 days</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={analytics.daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="profileViews" stroke="#22c55e" name="Profile views" />
                    <Line type="monotone" dataKey="offerClicks" stroke="#3b82f6" name="Offer clicks" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {analytics?.peakHours && Object.keys(analytics.peakHours).length > 0 && (
              <div>
                <h3 className="font-medium text-slate-700 mb-2">Peak hours (views by hour)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={Object.entries(analytics.peakHours).map(([hour, count]) => ({ hour: `${hour}:00`, count })).sort((a, b) => parseInt(a.hour, 10) - parseInt(b.hour, 10))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#22c55e" name="Views" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="goout-surface rounded-2xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display font-semibold text-lg">Live Offer Feed (Flash Deals)</h2>
              <button onClick={() => setShowOffer(true)} className="px-4 py-2 bg-goout-green text-white rounded-lg font-medium text-sm">
                + New Flash Deal
              </button>
            </div>
            {showOffer && (
              <form onSubmit={createOffer} className="mb-6 p-4 bg-slate-50 rounded-xl space-y-2">
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
                  <button type="submit" className="px-4 py-2 bg-goout-green text-white rounded-lg text-sm">Create Flash Deal</button>
                  <button type="button" onClick={() => setShowOffer(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                </div>
              </form>
            )}
            <div className="space-y-2">
              {offers.length === 0 ? (
                <p className="text-slate-500 text-sm">No active offers.</p>
              ) : (
                offers.map((o) => (
                  <div key={o._id} className="flex justify-between items-center p-3 bg-goout-mint rounded-lg">
                    <div>
                      <p className="font-medium">{o.title}</p>
                      <p className="text-sm text-slate-600">₹{o.offerPrice} {o.originalPrice && <span className="line-through">₹{o.originalPrice}</span>} · Valid till {new Date(o.validUntil).toLocaleString()}</p>
                    </div>
                    <button type="button" onClick={async () => { try { await api.patch(`/offers/${o._id}/stop`); setOffers((prev) => prev.filter((x) => x._id !== o._id)); } catch (e) { console.error(e); } }} className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200">Stop Deal</button>
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
