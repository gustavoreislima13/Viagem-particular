import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Briefcase,
  Calendar,
  Car,
  Check,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Crosshair,
  Crown,
  Flame,
  History,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Repeat,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserCheck,
  User as UserIcon,
  Wallet,
  X,
} from 'lucide-react';
import {
  FirebaseUser,
  ParsedFirebaseError,
  auth,
  collection,
  db,
  firebaseConfigError,
  formatFirebaseError,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  signInWithGooglePopup,
  signOutFirebase,
  testFirestoreConnection,
  where,
} from './lib/firebase.ts';
import {
  CURATED_SP_HUBS,
  LATE_CANCEL_PENALTY,
  OFFICIAL_PIX_KEY,
  VIP_MONTHLY_PRICE,
  api,
  buildRideSummaryText,
  buildWhatsappUrl,
  calculateRideQuote,
  formatCurrency,
  getVipTier,
} from './services/api.ts';
import {
  AiMode,
  AppSettings,
  GeoPlace,
  RecurrenceFrequency,
  Ride,
  RideCategory,
  RoundTripMode,
  RouteMetrics,
  ScheduleAvailabilityResponse,
  SecondaryPaymentMethod,
  UserProfile,
  Voucher,
  WhatsAppDispatchResult,
} from './types.ts';
import {
  DEFAULT_DRIVER_WHATSAPP,
  DEFAULT_SAFETY_MARGIN_MIN,
  computeOccupancyWindows,
  formatKmPtBr,
  formatSpTime,
} from './utils/schedule.ts';
import { QuotaBanner } from './components/QuotaBanner.tsx';
import { MapCanvas } from './components/MapCanvas.tsx';
import { LocationSearchModal } from './components/LocationSearchModal.tsx';
import { SuccessModal } from './components/SuccessModal.tsx';
import { VipClubModal } from './components/VipClubModal.tsx';
import { HistoryModal } from './components/HistoryModal.tsx';
import { AIConciergeModal } from './components/AIConciergeModal.tsx';
import { CreatorDashboardModal } from './components/CreatorDashboardModal.tsx';
import { OnboardingProfileModal } from './components/OnboardingProfileModal.tsx';
import { WalletModal } from './components/WalletModal.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';

const STRICT_ADMIN_EMAIL = 'reisanselmo7@gmail.com';

const DEFAULT_ORIGIN: GeoPlace = CURATED_SP_HUBS[0];

const DEFAULT_SETTINGS: AppSettings = {
  standardKm: 3.0,
  execKm: 3.6,
  roundTripKm: 3.0,
  minFare: 25.0,
  estimatedCostPerKm: 1.35,
  minMarginPct: 40,
  maxMarginPct: 80,
  safetyMarginMin: DEFAULT_SAFETY_MARGIN_MIN,
  pixKey: OFFICIAL_PIX_KEY,
  whatsapp: DEFAULT_DRIVER_WHATSAPP,
};

export default function App() {
  // System & Auth state
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<ParsedFirebaseError | null>(firebaseConfigError);
  const [profileSyncNotice, setProfileSyncNotice] = useState<ParsedFirebaseError | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [mapsBrowserKey, setMapsBrowserKey] = useState('');
  const [firestoreQuotaUrl, setFirestoreQuotaUrl] = useState<string | null>(null);

  // Map & Route state
  const [origin, setOrigin] = useState<GeoPlace>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<GeoPlace | null>(null);
  const [route, setRoute] = useState<RouteMetrics | null>(null);
  const [computingRoute, setComputingRoute] = useState(false);
  const [showTraffic, setShowTraffic] = useState(true);
  const [pinDropMode, setPinDropMode] = useState<'origin' | 'destination' | null>(null);
  const [centerTrigger, setCenterTrigger] = useState(0);

  // Bottom Sheet & Booking state
  const [sheetStep, setSheetStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<RideCategory>('exec');
  const [roundTripMode, setRoundTripMode] = useState<RoundTripMode>('continuous');
  const [waitTimeMin, setWaitTimeMin] = useState(30);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('none');
  const [ridePreferences, setRidePreferences] = useState('');
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [returnTime, setReturnTime] = useState('17:00');
  const [availability, setAvailability] = useState<ScheduleAvailabilityResponse | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [useWalletBalance, setUseWalletBalance] = useState(true);
  const [secondaryPaymentMethod, setSecondaryPaymentMethod] = useState<SecondaryPaymentMethod>('Pix');
  const [copiedBookingPix, setCopiedBookingPix] = useState(false);
  const [submittingRide, setSubmittingRide] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [cancelBannerMsg, setCancelBannerMsg] = useState<string | null>(null);

  // Loyalty, History & Modals
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [confirmedRide, setConfirmedRide] = useState<Ride | null>(null);
  const [confirmedWhatsapp, setConfirmedWhatsapp] = useState<WhatsAppDispatchResult | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [searchModal, setSearchModal] = useState<{ open: boolean; target: 'origin' | 'destination' }>({
    open: false,
    target: 'destination',
  });
  const [vipOpen, setVipOpen] = useState(false);
  const [vipTab, setVipTab] = useState<'membership' | 'recurrence' | 'raffles'>('membership');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiModal, setAiModal] = useState<{ open: boolean; mode: AiMode }>({
    open: false,
    mode: 'concierge',
  });
  const [dashboardOpen, setDashboardOpen] = useState(false);

  // Strict Two-Layer Admin check: exclusively reisanselmo7@gmail.com
  const isStrictAdmin = Boolean(
    user &&
      !user.isGuest &&
      user.isAdmin &&
      user.email.trim().toLowerCase() === STRICT_ADMIN_EMAIL
  );

  // Initial config & Firestore connectivity check
  useEffect(() => {
    api
      .getPublicConfig()
      .then((cfg) => {
        if (cfg.settings) setSettings(cfg.settings);
        if (cfg.mapsBrowserKey) setMapsBrowserKey(cfg.mapsBrowserKey);
      })
      .catch((err) => console.warn('Could not fetch public config:', err));

    testFirestoreConnection().then((res) => {
      if (res.quotaExceeded && res.upgradeUrl) {
        setFirestoreQuotaUrl(res.upgradeUrl);
      }
    });
  }, []);

  const syncInFlightRef = useRef<Promise<void> | null>(null);

  const refreshBackendData = useCallback(async (targetUser?: FirebaseUser | null) => {
    const fbUser = targetUser ?? auth.currentUser;
    if (!fbUser) return;
    if (syncInFlightRef.current) {
      return syncInFlightRef.current;
    }

    const task = (async () => {
      try {
        await fbUser.getIdToken();

        const [syncRes, ridesRes, cfgRes] = await Promise.all([
          api.syncAuth(),
          api.getRides().catch(() => ({ rides: [] as Ride[] })),
          api.getPublicConfig().catch(() => null),
        ]);

        if (cfgRes?.settings) {
          setSettings(cfgRes.settings);
        }

        setUser(syncRes.user);
        setVouchers(syncRes.vouchers || []);
        setRides(ridesRes.rides || []);
        if (syncRes.user.phone) {
          setClientPhone((prev) => prev || syncRes.user.phone);
        }
        setProfileSyncNotice(null);
      } catch (err) {
        const parsed = formatFirebaseError(err);
        console.error('Firestore profile sync error:', parsed.code, parsed.message);

        const isVerifiedStrictAdmin =
          Boolean(fbUser.emailVerified) &&
          (fbUser.email || '').trim().toLowerCase() === STRICT_ADMIN_EMAIL;

        // Safe fallback: if initial Firestore profile read fails or doc doesn't exist,
        // unlock the interface and open the mandatory onboarding registration modal.
        const fallbackUser: UserProfile = {
          uid: fbUser.uid,
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Passageiro VIP',
          email: fbUser.email || '',
          phone: fbUser.phoneNumber || '',
          address: '',
          cpf: '',
          profileCompleted: false,
          walletBalance: 0,
          pendingPenalty: 0,
          vipActive: false,
          photoUrl: fbUser.photoURL || '',
          points: 0,
          tier: 'Bronze',
          isAdmin: isVerifiedStrictAdmin,
        };

        setProfileSyncNotice(parsed);
        setAuthError(parsed);
        setUser(fallbackUser);
      } finally {
        syncInFlightRef.current = null;
      }
    })();

    syncInFlightRef.current = task;
    return task;
  }, []);

  // Firebase Auth listener with guaranteed loading termination
  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(
      auth,
      async (fbUser) => {
        try {
          if (fbUser) {
            await refreshBackendData(fbUser);
          } else if (active) {
            setUser((prev) => (prev?.isGuest ? prev : null));
          }
        } catch (err) {
          if (active) {
            setAuthError(formatFirebaseError(err));
          }
        } finally {
          if (active) {
            setAuthLoading(false);
          }
        }
      },
      (listenerErr) => {
        if (active) {
          setAuthError(formatFirebaseError(listenerErr));
          setAuthLoading(false);
        }
      }
    );
    return () => {
      active = false;
      unsub();
    };
  }, [refreshBackendData]);

  // Strict Admin route protection (redirect unauthorized /admin attempts back to /)
  useEffect(() => {
    const checkAdminRoute = () => {
      if (authLoading) return;
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const search = new URLSearchParams(window.location.search);
      const wantsAdmin =
        path.startsWith('/admin') ||
        path.includes('/painel') ||
        hash.includes('admin') ||
        search.has('admin') ||
        search.get('view') === 'admin';

      if (wantsAdmin) {
        if (isStrictAdmin) {
          setDashboardOpen(true);
        } else {
          setDashboardOpen(false);
          window.history.replaceState(null, '', '/');
        }
      } else if (!isStrictAdmin && dashboardOpen) {
        setDashboardOpen(false);
      }
    };

    checkAdminRoute();
    window.addEventListener('popstate', checkAdminRoute);
    window.addEventListener('hashchange', checkAdminRoute);
    return () => {
      window.removeEventListener('popstate', checkAdminRoute);
      window.removeEventListener('hashchange', checkAdminRoute);
    };
  }, [authLoading, isStrictAdmin, dashboardOpen]);

  // Populate default board preferences when VIP subscriber loads
  useEffect(() => {
    if (user?.vipActive) {
      const vp = user.vipPreferences;
      const formatted = [vp?.acTemp, vp?.rideStyle, vp?.favoriteTime ? `Horário ${vp.favoriteTime}` : '']
        .filter(Boolean)
        .join(' · ');
      if (formatted) {
        setRidePreferences((prev) => prev || formatted);
      }
    } else {
      setRecurrenceFrequency('none');
      setPointsToRedeem(0);
    }
  }, [user?.vipActive, user?.vipPreferences]);

  // Real-time Firestore rides listener when authenticated
  useEffect(() => {
    if (!user || user.isGuest || !auth.currentUser) return;

    const ridesQuery = isStrictAdmin
      ? query(collection(db, 'rides'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'rides'), where('userId', '==', user.uid));

    const unsub = onSnapshot(
      ridesQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          api
            .getRides()
            .then((r) => setRides(r.rides || []))
            .catch(() => {});
        }
      },
      (error) => {
        console.warn('Firestore rides snapshot warning:', error.message);
      }
    );

    return () => unsub();
  }, [user, isStrictAdmin]);

  // Compute route whenever origin and destination update
  useEffect(() => {
    if (!destination) {
      setRoute(null);
      return;
    }

    let cancelled = false;
    setComputingRoute(true);
    api
      .computeRoute(origin.lat, origin.lng, destination.lat, destination.lng)
      .then((res) => {
        if (!cancelled) {
          setRoute(res);
          setSheetStep(2);
        }
      })
      .catch((err) => console.error('Route error:', err))
      .finally(() => {
        if (!cancelled) setComputingRoute(false);
      });

    return () => {
      cancelled = true;
    };
  }, [origin, destination]);

  const selectedDurationMin = Math.max(
    1,
    Math.round(route?.durationInTrafficMin || route?.durationMin || 20)
  );

  const refreshAvailability = useCallback(async () => {
    if (!destination) return;
    setLoadingAvailability(true);
    try {
      const res = await api.getScheduleAvailability({
        date: scheduledDate,
        durationMin: selectedDurationMin,
        category,
        roundTripMode: category === 'roundtrip' ? roundTripMode : 'continuous',
        waitTimeMin: category === 'roundtrip' && roundTripMode === 'continuous' ? waitTimeMin : 0,
        returnDate: category === 'roundtrip' && roundTripMode === 'scheduled_return' ? returnDate : undefined,
        returnTime: category === 'roundtrip' && roundTripMode === 'scheduled_return' ? returnTime : undefined,
        selectedTime: scheduledTime,
      });
      setAvailability(res);
    } catch (err) {
      console.warn('Availability check warning:', err);
    } finally {
      setLoadingAvailability(false);
    }
  }, [
    destination,
    scheduledDate,
    scheduledTime,
    selectedDurationMin,
    category,
    roundTripMode,
    waitTimeMin,
    returnDate,
    returnTime,
  ]);

  useEffect(() => {
    if (!destination || sheetStep !== 2) return;
    refreshAvailability();
  }, [destination, sheetStep, refreshAvailability]);

  const localOccupancy = useMemo(
    () =>
      computeOccupancyWindows({
        scheduledDate,
        scheduledTime,
        durationMin: selectedDurationMin,
        isRoundTrip: category === 'roundtrip',
        safetyMarginMin: settings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN,
        roundTripMode,
        waitTimeMin,
        returnDate: category === 'roundtrip' && roundTripMode === 'scheduled_return' ? returnDate : undefined,
        returnTime: category === 'roundtrip' && roundTripMode === 'scheduled_return' ? returnTime : undefined,
      }),
    [
      scheduledDate,
      scheduledTime,
      selectedDurationMin,
      category,
      settings.safetyMarginMin,
      roundTripMode,
      waitTimeMin,
      returnDate,
      returnTime,
    ]
  );

  const scheduleConflictMessage = useMemo(() => {
    const conflictWindow =
      availability?.selectedConflict ||
      (category === 'roundtrip' && roundTripMode === 'scheduled_return'
        ? availability?.returnConflict
        : null);
    if (!conflictWindow) return null;
    const reasonText = conflictWindow.reason
      ? conflictWindow.reason
      : `Conflita com agenda ocupada (${conflictWindow.startLabel} às ${conflictWindow.endLabel})`;
    return `${reasonText} · ${conflictWindow.startLabel} às ${conflictWindow.endLabel}`;
  }, [availability, category, roundTripMode]);

  const hasScheduleConflict = Boolean(scheduleConflictMessage);

  const quote = useMemo(() => {
    const distanceKm = route?.distanceKm || 12.0;
    return calculateRideQuote({
      distanceKm,
      category,
      settings,
      userPoints: user?.points || 100,
      vipActive: Boolean(user?.vipActive),
      pointsToRedeem: user?.vipActive ? pointsToRedeem : 0,
      voucher: selectedVoucher,
    });
  }, [route, category, settings, user?.points, user?.vipActive, pointsToRedeem, selectedVoucher]);

  const pendingPenaltyAmount = Number(user?.pendingPenalty || 0);
  const totalWithPenalty = Number((quote.finalPrice + pendingPenaltyAmount).toFixed(2));
  const walletAvailable = Number(user?.walletBalance || 0);
  const walletWillDeduct =
    useWalletBalance && walletAvailable > 0
      ? Number(Math.min(walletAvailable, totalWithPenalty).toFixed(2))
      : 0;
  const remainingDue = Number(Math.max(0, totalWithPenalty - walletWillDeduct).toFixed(2));
  const effectivePixKey = settings.pixKey || OFFICIAL_PIX_KEY;

  const handleCopyBookingPix = async () => {
    try {
      await navigator.clipboard.writeText(effectivePixKey);
      setCopiedBookingPix(true);
      setTimeout(() => setCopiedBookingPix(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    setProfileSyncNotice(null);
    try {
      const fbUser = await signInWithGooglePopup();
      await refreshBackendData(fbUser);
    } catch (err) {
      const parsed = formatFirebaseError(err);
      setAuthError(parsed);
    } finally {
      setSigningIn(false);
      setAuthLoading(false);
    }
  };

  const handleEnterAsGuest = () => {
    setAuthError(null);
    setProfileSyncNotice(null);
    setUser({
      uid: 'guest-preview',
      name: 'Passageiro Visitante',
      email: 'visitante@demo.local',
      phone: '',
      address: '',
      cpf: '',
      profileCompleted: true,
      walletBalance: 0,
      pendingPenalty: 0,
      vipActive: false,
      photoUrl: '',
      points: 100,
      tier: 'Bronze',
      isAdmin: false,
      isGuest: true,
    });
  };

  const handleLogout = async () => {
    setDrawerOpen(false);
    setDashboardOpen(false);
    setProfileModalOpen(false);
    setProfileSyncNotice(null);
    if (auth.currentUser) {
      await signOutFirebase();
    }
    setUser(null);
    setRides([]);
    setVouchers([]);
    setSelectedVoucher(null);
    setPointsToRedeem(0);
    setRecurrenceFrequency('none');
  };

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setCenterTrigger((c) => c + 1);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const place = await api.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          setOrigin(place);
          setCenterTrigger((c) => c + 1);
        } catch {
          setOrigin({
            name: 'Minha Localização Atual',
            address: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          setCenterTrigger((c) => c + 1);
        }
      },
      () => setCenterTrigger((c) => c + 1),
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  const handleMapClickPin = async (lat: number, lng: number) => {
    if (!pinDropMode) return;
    const mode = pinDropMode;
    setPinDropMode(null);

    try {
      const place = await api.reverseGeocode(lat, lng);
      if (mode === 'origin') setOrigin(place);
      else setDestination(place);
    } catch {
      const fallbackPlace: GeoPlace = {
        name: mode === 'origin' ? 'Embarque no Mapa' : 'Destino no Mapa',
        address: `Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`,
        lat,
        lng,
      };
      if (mode === 'origin') setOrigin(fallbackPlace);
      else setDestination(fallbackPlace);
    }
  };

  const triggerWhatsappAutoOpen = (url: string) => {
    if (!url) return;
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Fallback button in SuccessModal always remains available
    }
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination || !user || hasScheduleConflict) return;
    setBookingError(null);
    setSubmittingRide(true);

    const distanceKm = route?.distanceKm || 12.0;
    const durationMin = selectedDurationMin;
    const isRoundTrip = category === 'roundtrip';
    const effectiveRoundTripMode: RoundTripMode =
      isRoundTrip && roundTripMode === 'scheduled_return' ? 'scheduled_return' : 'continuous';
    const effectiveWaitMin = isRoundTrip && effectiveRoundTripMode === 'continuous' ? waitTimeMin : 0;
    const effectiveReturnDate =
      isRoundTrip && effectiveRoundTripMode === 'scheduled_return' ? returnDate : '';
    const effectiveReturnTime =
      isRoundTrip && effectiveRoundTripMode === 'scheduled_return' ? returnTime : '';

    try {
      if (user.isGuest) {
        const guestRide: Ride = {
          rideCode: `SIM-${Date.now().toString(36).toUpperCase()}`,
          userId: user.uid,
          clientName: user.name,
          clientPhone: clientPhone || '(11) 99999-9999',
          originName: origin.name,
          originAddress: origin.address,
          originLat: origin.lat,
          originLng: origin.lng,
          destinationName: destination.name,
          destinationAddress: destination.address,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
          distanceKm,
          durationMin,
          totalOccupiedMin: localOccupancy.totalOccupiedMin,
          safetyMarginMin: localOccupancy.safetyMarginMin,
          roundTripMode: effectiveRoundTripMode,
          waitTimeMin: effectiveWaitMin,
          returnDate: effectiveReturnDate,
          returnTime: effectiveReturnTime,
          startTime: localOccupancy.outboundStart.toISOString(),
          endTime: localOccupancy.outboundEnd.toISOString(),
          returnStartTime: localOccupancy.returnStart?.toISOString() || null,
          returnEndTime: localOccupancy.returnEnd?.toISOString() || null,
          category,
          isRoundTrip,
          recurrenceFrequency: 'none',
          scheduledDate,
          scheduledTime,
          price: quote.finalPrice,
          paymentMethod: secondaryPaymentMethod,
          paymentStatus:
            secondaryPaymentMethod === 'Cartão Presencial'
              ? 'Pagamento presencial na maquininha'
              : 'Aguardando pagamento via Pix',
          walletDeducted: 0,
          remainingDue: quote.finalPrice,
          penaltyIncluded: 0,
          pointsEarned: quote.pointsEarned,
          pointsRedeemed: 0,
          notes,
          status: 'Confirmado',
        };
        const msgPreview = buildRideSummaryText(guestRide, settings, false);
        const waUrl = buildWhatsappUrl(guestRide, settings.whatsapp, settings.pixKey, false);
        setRides((prev) => [guestRide, ...prev]);
        setConfirmedRide(guestRide);
        setConfirmedWhatsapp({
          dispatched: false,
          mode: 'whatsapp-deep-link',
          recipients: [settings.whatsapp || DEFAULT_DRIVER_WHATSAPP],
          messagePreview: msgPreview,
          whatsappUrl: waUrl,
          statusDetail:
            'Resumo preparado. Clique no botão verde para enviar no WhatsApp.',
        });
        triggerWhatsappAutoOpen(waUrl);
        return;
      }

      const activeRecurrence = user.vipActive ? recurrenceFrequency : 'none';
      const activePrefs = user.vipActive ? ridePreferences.trim().slice(0, 280) : '';

      // Atomic ride + schedule slot + wallet deduction write directly in Firestore
      const res = await api.createRide({
        clientName: user.name,
        clientPhone: clientPhone.trim() || user.phone || '',
        originName: origin.name,
        originAddress: origin.address,
        originLat: origin.lat,
        originLng: origin.lng,
        destinationName: destination.name,
        destinationAddress: destination.address,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        distanceKm,
        durationMin,
        category,
        isRoundTrip,
        roundTripMode: effectiveRoundTripMode,
        waitTimeMin: effectiveWaitMin,
        returnDate: effectiveReturnDate || undefined,
        returnTime: effectiveReturnTime || undefined,
        recurrenceFrequency: activeRecurrence,
        preferences: activePrefs,
        scheduledDate,
        scheduledTime,
        notes: notes.trim(),
        voucherCode: selectedVoucher?.voucherCode,
        pointsRedeemed: quote.pointsRedeemed,
        useWalletBalance,
        secondaryPaymentMethod,
      });

      const createdRide = res.ride;

      setRides((prev) => [createdRide, ...prev]);
      if (res.updatedUser) {
        setUser(res.updatedUser);
      } else if (typeof res.updatedUserPoints === 'number') {
        const nextPts = res.updatedUserPoints;
        setUser((u) => (u ? { ...u, points: nextPts, tier: getVipTier(nextPts) } : u));
      }
      if (selectedVoucher) {
        setVouchers((prev) =>
          prev.map((v) =>
            v.voucherCode === selectedVoucher.voucherCode ? { ...v, used: true } : v
          )
        );
        setSelectedVoucher(null);
      }
      setPointsToRedeem(0);
      setRecurrenceFrequency('none');
      setConfirmedRide(createdRide);
      setConfirmedWhatsapp(res.whatsappDispatch || null);
      refreshAvailability();

      const autoUrl =
        res.whatsappDispatch?.whatsappUrl ||
        buildWhatsappUrl(
          createdRide,
          settings.whatsapp,
          settings.pixKey,
          Boolean(res.updatedUser?.vipActive ?? user.vipActive)
        );
      if (!res.whatsappDispatch?.dispatched) {
        triggerWhatsappAutoOpen(autoUrl);
      }
    } catch (err: any) {
      setBookingError(err?.message || 'Erro ao finalizar agendamento.');
      if (err?.status === 409) {
        refreshAvailability();
      }
    } finally {
      setSubmittingRide(false);
    }
  };

  const handleCancelRide = async (rideCode: string) => {
    if (user?.isGuest) {
      setRides((prev) =>
        prev.map((r) => (r.rideCode === rideCode ? { ...r, status: 'Cancelado' } : r))
      );
      return;
    }

    try {
      const res = await api.updateRideStatus(rideCode, 'Cancelado');
      setRides((prev) =>
        prev.map((r) => (r.rideCode === rideCode ? { ...r, status: 'Cancelado' } : r))
      );
      refreshAvailability();
      if (res.updatedUser) {
        setUser(res.updatedUser);
      }
      if ((res.penaltyCharged || 0) > 0) {
        setCancelBannerMsg(
          res.penaltyMode === 'wallet'
            ? `Corrida ${rideCode} cancelada com <= 30 min de antecedência. Multa de ${formatCurrency(
                res.penaltyCharged || LATE_CANCEL_PENALTY
              )} descontada automaticamente da sua Carteira.`
            : `Corrida ${rideCode} cancelada com <= 30 min de antecedência. Multa de ${formatCurrency(
                res.penaltyCharged || LATE_CANCEL_PENALTY
              )} registrada como pendência para sua próxima corrida.`
        );
        setTimeout(() => setCancelBannerMsg(null), 9000);
      }
    } catch (err: any) {
      setBookingError(err?.message || 'Não foi possível cancelar esta corrida.');
    }
  };

  // =========================================================
  // LOADING SPLASH
  // =========================================================
  if (authLoading) {
    return (
      <div className="min-h-screen w-full bg-obsidian flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 rounded-2xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center mb-4">
          <Car className="w-8 h-8 animate-pulse" />
        </div>
        <h1 className="font-display text-xl font-bold text-white">Gustavo Reis</h1>
        <p className="text-xs text-slate-400 mt-1">Conectando Mobilidade VIP...</p>
      </div>
    );
  }

  // =========================================================
  // AUTHENTICATION SCREEN
  // =========================================================
  if (!user) {
    return (
      <div className="min-h-screen w-full bg-obsidian flex items-center justify-center p-5 relative overflow-y-auto">
        <OfflineIndicator />
        <QuotaBanner />
        <div className="glass-panel max-w-md w-full rounded-3xl p-7 shadow-2xl border border-white/10">
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-16 h-16 rounded-2xl bg-emeraldVip/15 border border-emeraldVip/30 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(16,185,129,0.22)] text-emeraldVip">
              <Car className="w-8 h-8" />
            </div>
            <h1 className="font-display text-2xl font-bold text-white tracking-tight">
              Gustavo Reis
            </h1>
            <p className="text-emeraldVip text-[11px] font-semibold uppercase tracking-widest mt-1">
              Mobilidade Particular &amp; Clube VIP
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Tarifa transparente a partir de {formatCurrency(Math.max(3, settings.execKm))}/km · Trânsito em tempo real · Agendamento inteligente
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="mb-4 p-3.5 rounded-xl bg-red-500/15 border border-red-500/40 text-xs text-red-100 space-y-1"
            >
              <div className="flex items-center gap-2 font-bold text-red-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Não foi possível concluir a autenticação</span>
              </div>
              {authError.code && (
                <p className="font-mono text-[11px] text-red-200/90 break-all">
                  Código: {authError.code}
                </p>
              )}
              <p className="text-red-100 break-words">{authError.message}</p>
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={signingIn}
              onClick={handleGoogleSignIn}
              className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-3 shadow-lg transition-all disabled:opacity-60"
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              )}
              {signingIn ? 'Autenticando...' : 'Entrar com Google (Passageiro / Motorista)'}
            </button>

            <button
              type="button"
              onClick={handleEnterAsGuest}
              className="w-full py-3.5 px-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-white/10 text-slate-200 font-semibold text-xs transition-all"
            >
              Simular Corrida sem Login (Modo Visitante)
            </button>
          </div>

          <div className="mt-4">
            <PWAInstallButton variant="drawer" />
          </div>

          <div className="mt-6 pt-5 border-t border-white/10 text-center space-y-1.5">
            <p className="text-[11px] text-slate-400">
              Segurança reforçada com Firebase Auth e Cloud Firestore em tempo real.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const requiresOnboarding = Boolean(user && !user.isGuest && !user.profileCompleted);

  // =========================================================
  // MAIN MOBILE/DESKTOP APP SHELL
  // =========================================================
  return (
    <div className="relative w-full h-full bg-obsidian overflow-hidden">
      <OfflineIndicator />
      <QuotaBanner />

      {firestoreQuotaUrl && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[450] bg-amber-950/95 border border-amber-500/40 px-4 py-2 rounded-xl text-xs text-amber-100 shadow-xl">
          Limite diário do Firestore gratuito atingido.{' '}
          <a
            href={firestoreQuotaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold text-amber-300"
          >
            Gerenciar no Console Firebase
          </a>
        </div>
      )}

      {/* SIDE NAVIGATION DRAWER */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[190] bg-black/65 backdrop-blur-sm flex"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="w-80 max-w-[85vw] h-full glass-panel border-r border-white/10 p-5 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display font-bold text-lg text-white">Gustavo Reis</h2>
                  <p className="text-[11px] text-emeraldVip font-semibold">Mobilidade Executiva</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Fechar menu"
                  className="w-9 h-9 rounded-full bg-slate-800/80 text-slate-300 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Profile summary */}
              <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4 flex items-center gap-3">
                {user.photoUrl ? (
                  <img
                    src={user.photoUrl}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-full object-cover border border-emeraldVip/40"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-emeraldVip/20 text-emeraldVip font-bold flex items-center justify-center">
                    {user.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{user.name}</p>
                  <p className="text-[11px] text-goldVip font-semibold">
                    {user.tier} · {user.points} pts VIP
                  </p>
                  <p className="text-[11px] text-emeraldVip font-bold tabular-nums mt-0.5">
                    Saldo Carteira: {formatCurrency(walletAvailable)}
                  </p>
                </div>
              </div>

              {/* Navigation items */}
              <nav className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setWalletOpen(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-xl bg-emeraldVip/10 hover:bg-emeraldVip/20 border border-emeraldVip/25 text-left text-sm font-bold text-white flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-3">
                    <Wallet className="w-4 h-4 text-emeraldVip" />
                    Minha Carteira
                  </span>
                  <span className="text-xs font-extrabold text-emeraldVip tabular-nums">
                    {formatCurrency(walletAvailable)}
                  </span>
                </button>

                {!user.isGuest && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      setProfileModalOpen(true);
                    }}
                    className="w-full px-3.5 py-3 rounded-xl hover:bg-slate-800/80 text-left text-sm font-medium text-slate-200 flex items-center gap-3"
                  >
                    <UserCheck className="w-4 h-4 text-emeraldVip" />
                    Meu Perfil &amp; Dados Cadastrais
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setHistoryOpen(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-xl hover:bg-slate-800/80 text-left text-sm font-medium text-slate-200 flex items-center gap-3"
                >
                  <History className="w-4 h-4 text-emeraldVip" />
                  Minhas Viagens ({rides.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setVipTab('membership');
                    setVipOpen(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-xl hover:bg-slate-800/80 text-left text-sm font-medium text-slate-200 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-3">
                    <Crown className="w-4 h-4 text-goldVip" />
                    Clube VIP ({formatCurrency(VIP_MONTHLY_PRICE)}/mês)
                  </span>
                  {user.vipActive && (
                    <span className="px-2 py-0.5 rounded-md bg-emeraldVip/20 text-emeraldVip text-[10px] font-bold">
                      ATIVO
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setVipTab('raffles');
                    setVipOpen(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-xl hover:bg-slate-800/80 text-left text-sm font-medium text-slate-200 flex items-center gap-3"
                >
                  <Ticket className="w-4 h-4 text-goldVip" />
                  Sorteios em Lojas Parceiras
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setAiModal({ open: true, mode: 'concierge' });
                  }}
                  className="w-full px-3.5 py-3 rounded-xl hover:bg-slate-800/80 text-left text-sm font-medium text-slate-200 flex items-center gap-3"
                >
                  <Sparkles className="w-4 h-4 text-emeraldVip" />
                  Concierge IA &amp; Maps Grounding
                </button>

                {isStrictAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      setDashboardOpen(true);
                    }}
                    className="w-full px-3.5 py-3 rounded-xl bg-goldVip/10 hover:bg-goldVip/20 border border-goldVip/25 text-left text-sm font-bold text-goldVip flex items-center gap-3"
                  >
                    <BarChart3 className="w-4 h-4" />
                    Painel do Motorista (Admin)
                  </button>
                )}
              </nav>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-2">
              <PWAInstallButton variant="drawer" />
              {user.isGuest && (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="w-full py-2.5 px-3 rounded-xl bg-white text-slate-900 font-bold text-xs flex items-center justify-center gap-2"
                >
                  <UserIcon className="w-3.5 h-3.5" />
                  Conectar Conta Google
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair da Sessão
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* TOP FLOATING HEADER */}
      <header className="fixed top-3 left-3 right-3 z-[100] pointer-events-none flex items-center justify-between gap-2 max-w-5xl mx-auto">
        <div className="pointer-events-auto glass-panel rounded-2xl px-3 py-2 flex items-center gap-3 shadow-xl">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menu lateral"
            className="w-10 h-10 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-colors shrink-0"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="min-w-0">
            <h1 className="font-display font-bold text-sm text-white leading-tight whitespace-nowrap">
              Gustavo Reis
            </h1>
            <p className="text-[11px] text-slate-400 truncate whitespace-nowrap">
              4.99★ · Motorista Particular
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowTraffic((t) => !t)}
            className={`px-3 py-2.5 rounded-2xl text-xs font-semibold border backdrop-blur-md shadow-lg inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              showTraffic
                ? 'bg-emeraldVip/20 border-emeraldVip/40 text-emeraldVip'
                : 'glass-panel text-slate-300'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Trânsito</span>
          </button>

          <button
            type="button"
            onClick={() => setAiModal({ open: true, mode: 'concierge' })}
            className="glass-panel hover:bg-slate-800/90 px-3 py-2.5 rounded-2xl text-xs font-semibold text-white shadow-lg inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-emeraldVip" />
            <span>IA VIP</span>
          </button>

          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            title="Minha Carteira Digital"
            className="glass-panel hover:bg-slate-800/90 px-3 py-2.5 rounded-2xl text-xs font-bold text-emeraldVip shadow-lg inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums relative"
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>{formatCurrency(walletAvailable)}</span>
            {pendingPenaltyAmount > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setVipTab('membership');
              setVipOpen(true);
            }}
            className="glass-panel hover:bg-slate-800/90 px-3 py-2.5 rounded-2xl text-xs font-bold text-goldVip shadow-lg inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums"
          >
            <Crown className="w-3.5 h-3.5" />
            <span>{user.points}</span>
          </button>

          <PWAInstallButton variant="compact" />

          {isStrictAdmin && (
            <button
              type="button"
              onClick={() => setDashboardOpen(true)}
              className="bg-goldVip text-slate-950 hover:brightness-110 px-3 py-2.5 rounded-2xl text-xs font-bold shadow-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Painel</span>
            </button>
          )}
        </div>
      </header>

      {cancelBannerMsg && (
        <div className="fixed top-20 left-3 right-3 z-[180] max-w-lg mx-auto rounded-2xl bg-red-950/95 border border-red-500/40 px-4 py-3 text-xs text-red-100 shadow-2xl flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="flex-1 leading-relaxed">{cancelBannerMsg}</p>
          <button
            type="button"
            onClick={() => setCancelBannerMsg(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* FULLSCREEN MAP CANVAS */}
      <MapCanvas
        apiKey={mapsBrowserKey}
        origin={origin}
        destination={destination}
        route={route}
        showTraffic={showTraffic}
        pinDropMode={pinDropMode}
        centerTrigger={centerTrigger}
        onMapClickPin={handleMapClickPin}
      />

      {/* FLOATING GPS RECENTER BUTTON */}
      <button
        type="button"
        onClick={handleUseGps}
        aria-label="Centralizar GPS atual"
        className="fixed right-4 bottom-[290px] sm:bottom-[310px] z-[95] w-11 h-11 rounded-2xl glass-panel hover:bg-slate-800 text-emeraldVip flex items-center justify-center shadow-xl transition-transform active:scale-95"
      >
        <Crosshair className="w-5 h-5" />
      </button>

      {/* BOTTOM FLOATING SHEET (2 STEPS) */}
      <section className="fixed bottom-3 left-3 right-3 z-[100] max-w-xl mx-auto">
        <div className="glass-panel rounded-3xl p-4 sm:p-5 shadow-2xl border border-white/10 max-h-[68vh] overflow-y-auto">
          {sheetStep === 1 ? (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-base text-white">
                  Para onde vamos hoje?
                </h2>
                <span className="text-[11px] font-semibold text-emeraldVip tabular-nums">
                  A partir de {formatCurrency(Math.max(3, settings.execKm))}/km
                </span>
              </div>

              {/* Origin Selector */}
              <button
                type="button"
                onClick={() => setSearchModal({ open: true, target: 'origin' })}
                className="w-full p-3 rounded-2xl bg-slate-900/85 hover:bg-slate-800/90 border border-white/10 flex items-center gap-3 text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-emeraldVip/15 text-emeraldVip flex items-center justify-center shrink-0">
                  <Navigation className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Embarque
                  </p>
                  <p className="text-xs sm:text-sm font-semibold text-white truncate">
                    {origin.name}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
              </button>

              {/* Destination Selector */}
              <button
                type="button"
                onClick={() => setSearchModal({ open: true, target: 'destination' })}
                className="w-full p-3 rounded-2xl bg-slate-900/85 hover:bg-slate-800/90 border border-goldVip/30 flex items-center gap-3 text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-goldVip/15 text-goldVip flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Destino
                  </p>
                  <p className="text-xs sm:text-sm font-semibold text-white truncate">
                    {destination ? destination.name : 'Toque para buscar endereço ou aeroporto...'}
                  </p>
                </div>
                {computingRoute ? (
                  <Loader2 className="w-4 h-4 text-emeraldVip animate-spin shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                )}
              </button>

              {/* Quick Hubs Row */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-0.5">
                {CURATED_SP_HUBS.slice(1, 6).map((hub) => (
                  <button
                    key={hub.name}
                    type="button"
                    onClick={() => setDestination(hub)}
                    className="px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors"
                  >
                    {hub.name.split('(')[0].trim()}
                  </button>
                ))}
              </div>

              {destination && (
                <button
                  type="button"
                  onClick={() => setSheetStep(2)}
                  className="w-full py-3.5 rounded-2xl bg-emeraldVip hover:brightness-110 text-slate-950 font-bold text-sm transition-all"
                >
                  Continuar para Cotação (
                  {Number.isFinite(Number(route?.distanceKm))
                    ? `${formatKmPtBr(Number(route?.distanceKm))} km (~${selectedDurationMin} min)`
                    : 'Calculando...'}
                  )
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={handleConfirmBooking} className="space-y-3.5">
              {/* Step 2 Header */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSheetStep(1)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Editar Rota
                </button>

                <div className="text-right text-xs text-slate-300 tabular-nums">
                  {computingRoute ? (
                    <span className="inline-flex items-center gap-1 text-emeraldVip">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculando rota...
                    </span>
                  ) : (
                    <span>
                      <strong>{formatKmPtBr(route?.distanceKm || quote.effectiveKm)} km</strong> (~
                      <strong>{selectedDurationMin} min</strong>)
                      {route && route.trafficDeltaMin > 0
                        ? ` · +${route.trafficDeltaMin} min trânsito`
                        : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Simplified 2-Option Categories Grid: Executiva & Ida e Volta */}
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  {
                    id: 'exec' as const,
                    label: 'Executiva',
                    desc: 'Somente ida',
                    sub: `${formatCurrency(Math.max(3, settings.execKm))}/km`,
                    icon: Briefcase,
                  },
                  {
                    id: 'roundtrip' as const,
                    label: 'Ida e Volta',
                    desc: 'Retorno (-10%)',
                    sub: `${formatCurrency(Math.max(3, settings.roundTripKm))}/km`,
                    icon: Repeat,
                  },
                ].map((cat) => {
                  const Icon = cat.icon;
                  const active = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        active
                          ? 'bg-emeraldVip/15 border-emeraldVip ring-1 ring-emeraldVip/60 text-white shadow-lg shadow-emeraldVip/10'
                          : 'bg-slate-900/75 border-white/10 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Icon
                          className={`w-4 h-4 ${active ? 'text-emeraldVip' : 'text-slate-400'}`}
                        />
                        <span className="text-[10px] font-bold text-emeraldVip tabular-nums">
                          {cat.sub}
                        </span>
                      </div>
                      <p className="text-sm font-bold leading-tight">{cat.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{cat.desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Round-Trip Mode Options (Continuous vs Scheduled Return) */}
              {category === 'roundtrip' && (
                <div className="rounded-2xl bg-slate-900/80 border border-emeraldVip/25 p-3 space-y-2.5 text-xs">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRoundTripMode('continuous')}
                      className={`py-2 px-2.5 rounded-xl border text-[11px] font-bold transition-colors ${
                        roundTripMode === 'continuous'
                          ? 'bg-emeraldVip text-slate-950 border-emeraldVip'
                          : 'bg-slate-950/75 text-slate-300 border-white/10 hover:bg-slate-800'
                      }`}
                    >
                      Retorno Contínuo
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoundTripMode('scheduled_return')}
                      className={`py-2 px-2.5 rounded-xl border text-[11px] font-bold transition-colors ${
                        roundTripMode === 'scheduled_return'
                          ? 'bg-emeraldVip text-slate-950 border-emeraldVip'
                          : 'bg-slate-950/75 text-slate-300 border-white/10 hover:bg-slate-800'
                      }`}
                    >
                      Horário Específico de Volta
                    </button>
                  </div>

                  {roundTripMode === 'continuous' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-300">
                        Tempo de espera no destino:
                      </span>
                      <div className="flex items-center gap-1.5">
                        {[0, 15, 30, 60, 120].map((min) => (
                          <button
                            key={min}
                            type="button"
                            onClick={() => setWaitTimeMin(min)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold tabular-nums border ${
                              waitTimeMin === min
                                ? 'bg-goldVip text-slate-950 border-goldVip'
                                : 'bg-slate-950 text-slate-300 border-white/10 hover:bg-slate-800'
                            }`}
                          >
                            {min === 0 ? 'Sem espera' : `${min} min`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                          Data da Volta
                        </label>
                        <input
                          type="date"
                          required
                          value={returnDate}
                          min={scheduledDate}
                          onChange={(e) => setReturnDate(e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                          Horário da Volta
                        </label>
                        <input
                          type="time"
                          required
                          value={returnTime}
                          onChange={(e) => setReturnTime(e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VIP Recurrence & Board Preferences (Unlocked for Active VIPs, Locked CTA otherwise) */}
              {user.vipActive ? (
                <div className="rounded-2xl bg-slate-900/80 border border-emeraldVip/30 p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-emeraldVip inline-flex items-center gap-1.5">
                      <Crown className="w-3.5 h-3.5 text-goldVip" />
                      Recorrência VIP &amp; Preferências
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setVipTab('recurrence');
                        setVipOpen(true);
                      }}
                      className="text-[11px] text-goldVip font-semibold hover:underline"
                    >
                      Editar padrão VIP
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'none', label: 'Única' },
                        { id: 'daily', label: 'Diária' },
                        { id: 'weekly', label: 'Semanal' },
                        { id: 'monthly', label: 'Mensal' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRecurrenceFrequency(opt.id)}
                        className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-colors ${
                          recurrenceFrequency === opt.id
                            ? 'bg-emeraldVip text-slate-950 border-emeraldVip font-bold'
                            : 'bg-slate-950/70 text-slate-300 border-white/10 hover:bg-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={ridePreferences}
                    onChange={(e) => setRidePreferences(e.target.value)}
                    placeholder="Preferências VIP (ex: Ar 21°C · Viagem Silenciosa)"
                    maxLength={250}
                    className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-white placeholder-slate-500 outline-none"
                  />
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-900/80 border border-goldVip/25 px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-goldVip/15 text-goldVip flex items-center justify-center shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        Agendamento Recorrente &amp; Preferências
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        Diária, Semanal ou Mensal + descontos com pontos e sorteios.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVipTab('recurrence');
                      setVipOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-goldVip text-slate-950 font-bold text-[11px] hover:brightness-110 whitespace-nowrap shrink-0"
                  >
                    Assinar {formatCurrency(VIP_MONTHLY_PRICE)}/mês
                  </button>
                </div>
              )}

              {/* Discounts, Direct VIP Points Redemption & Vouchers */}
              <div className="rounded-2xl bg-slate-900/75 border border-white/10 px-3.5 py-2.5 space-y-2 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-300">
                    Clube {getVipTier(user.points)}{' '}
                    {quote.tierDiscount > 0
                      ? `(-${formatCurrency(quote.tierDiscount)})`
                      : ''}
                    {selectedVoucher
                      ? ` · Voucher -${formatCurrency(selectedVoucher.discountValue)}`
                      : ''}
                    {quote.pointsDiscount > 0
                      ? ` · Pontos -${formatCurrency(quote.pointsDiscount)}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setVipTab('membership');
                      setVipOpen(true);
                    }}
                    className="text-goldVip font-bold hover:underline"
                  >
                    {selectedVoucher ? 'Trocar Voucher' : 'Clube VIP & Vouchers'}
                  </button>
                </div>

                {user.vipActive && user.points >= 100 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/10">
                    <span className="text-emeraldVip font-semibold tabular-nums">
                      Usar saldo ({user.points} pts):
                    </span>
                    <div className="flex items-center gap-1.5">
                      {[0, 100, 200, 500].map((pts) => {
                        const disabled = pts > user.points;
                        const active = pointsToRedeem === pts;
                        return (
                          <button
                            key={pts}
                            type="button"
                            disabled={disabled}
                            onClick={() => setPointsToRedeem(pts)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold tabular-nums border transition-colors ${
                              active
                                ? 'bg-goldVip text-slate-950 border-goldVip'
                                : disabled
                                  ? 'bg-slate-950 text-slate-600 border-white/5 cursor-not-allowed'
                                  : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
                            }`}
                          >
                            {pts === 0 ? 'Não usar' : `${pts} pts (-R$${(pts / 100) * 5})`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Scheduling, Conflict-Free Slots & Notes */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="flex items-center gap-1.5 bg-slate-900/90 border border-white/10 rounded-xl px-2.5 py-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="date"
                      required
                      value={scheduledDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setScheduledDate(val);
                        if (returnDate < val) setReturnDate(val);
                      }}
                      className="w-full bg-transparent text-xs text-white outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-900/90 border border-white/10 rounded-xl px-2.5 py-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="time"
                      required
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full bg-transparent text-xs text-white outline-none"
                    />
                  </div>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="WhatsApp (11) 9..."
                    className="col-span-2 sm:col-span-1 bg-slate-900/90 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
                  />
                </div>

                {/* Calculated Occupancy Window & Live Conflict Slots */}
                <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-3 space-y-2 text-[11px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-300 font-semibold inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-emeraldVip" />
                      Agenda bloqueada:{' '}
                      <strong className="text-white font-mono tabular-nums">
                        {formatSpTime(localOccupancy.outboundStart)} às{' '}
                        {formatSpTime(localOccupancy.outboundEnd)}
                      </strong>
                      {localOccupancy.returnStart && localOccupancy.returnEnd && (
                        <>
                          {' '}
                          + Volta{' '}
                          <strong className="text-white font-mono tabular-nums">
                            {formatSpTime(localOccupancy.returnStart)} às{' '}
                            {formatSpTime(localOccupancy.returnEnd)}
                          </strong>
                        </>
                      )}
                    </span>
                    <span className="text-slate-400 tabular-nums">
                      {loadingAvailability
                        ? 'Verificando...'
                        : `Margem +${localOccupancy.safetyMarginMin} min`}
                    </span>
                  </div>

                  {availability?.slots && availability.slots.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                      {availability.slots.map((slot) => {
                        const isSelected = scheduledTime === slot.time;
                        const isOccupied = Boolean(slot.occupied);
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            disabled={isOccupied}
                            title={
                              isOccupied
                                ? `Ocupado (conflita com ${slot.conflictWindowLabel || 'horário reservado'})`
                                : `Livre (${slot.windowStartLabel} às ${slot.windowEndLabel})`
                            }
                            onClick={() => setScheduledTime(slot.time)}
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono tabular-nums shrink-0 border transition-colors ${
                              isOccupied
                                ? 'bg-red-950/40 border-red-500/25 text-red-300/70 cursor-not-allowed'
                                : isSelected
                                  ? 'bg-emeraldVip text-slate-950 border-emeraldVip font-bold'
                                  : 'bg-slate-950/80 text-slate-200 border-white/10 hover:bg-slate-800'
                            }`}
                          >
                            {slot.time}
                            {isOccupied ? ' · Ocupado' : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {scheduleConflictMessage && (
                    <div className="rounded-xl bg-red-950/50 border border-red-500/40 px-3 py-2 text-[11px] text-red-200 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span>
                        <strong>Horário indisponível:</strong> {scheduleConflictMessage}. Escolha outro horário livre.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações (nº do voo, malas, portaria, parada extra)..."
                maxLength={350}
                className="w-full bg-slate-900/90 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
              />

              {/* Pending Late-Cancel Penalty Notice */}
              {pendingPenaltyAmount > 0 && (
                <div className="rounded-2xl bg-red-950/50 border border-red-500/40 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-red-100">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    Multa pendente de cancelamento tardio incluída:
                  </span>
                  <strong className="font-mono text-red-300 tabular-nums">
                    +{formatCurrency(pendingPenaltyAmount)}
                  </strong>
                </div>
              )}

              {/* Digital Wallet Auto-Deduction Card */}
              <div className="rounded-2xl bg-slate-900/85 border border-emeraldVip/25 px-3.5 py-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emeraldVip shrink-0" />
                    <span className="font-bold text-white">
                      Carteira Digital · Saldo:{' '}
                      <span className="text-emeraldVip tabular-nums">
                        {formatCurrency(walletAvailable)}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWalletOpen(true)}
                    className="text-[11px] font-bold text-emeraldVip hover:underline"
                  >
                    + Adicionar Crédito
                  </button>
                </div>

                {walletAvailable > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
                    <label className="flex items-center gap-2 text-[11px] text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useWalletBalance}
                        onChange={(e) => setUseWalletBalance(e.target.checked)}
                        className="accent-emeraldVip rounded"
                      />
                      Abater saldo automaticamente nesta viagem
                    </label>
                    {walletWillDeduct > 0 && (
                      <span className="text-[11px] font-bold text-emeraldVip tabular-nums">
                        {remainingDue <= 0
                          ? `Pago integralmente via Carteira (-${formatCurrency(walletWillDeduct)})`
                          : `Abate -${formatCurrency(walletWillDeduct)} · Restante: ${formatCurrency(remainingDue)}`}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Adicione créditos via Pix na sua Carteira para pagamento instantâneo e sem fila.
                  </p>
                )}
              </div>

              {/* Payment Method Selector (Pix vs Cartão Presencial) when remainingDue > 0 */}
              {remainingDue > 0 && (
                <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">
                      Forma de Pagamento {walletWillDeduct > 0 ? 'do Restante' : 'da Viagem'}{' '}
                      <span className="text-emeraldVip tabular-nums">
                        ({formatCurrency(remainingDue)})
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSecondaryPaymentMethod('Pix')}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        secondaryPaymentMethod === 'Pix'
                          ? 'bg-emeraldVip/15 border-emeraldVip text-white'
                          : 'bg-slate-950/75 border-white/10 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <p className="text-xs font-bold flex items-center gap-1.5">
                        <Copy className="w-3.5 h-3.5 text-emeraldVip" />
                        1. Pix
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Chave aleatória + envio do comprovante
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSecondaryPaymentMethod('Cartão Presencial')}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        secondaryPaymentMethod === 'Cartão Presencial'
                          ? 'bg-goldVip/15 border-goldVip text-white'
                          : 'bg-slate-950/75 border-white/10 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <p className="text-xs font-bold flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-goldVip" />
                        2. Cartão (Crédito/Débito)
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Na maquininha ao final da corrida
                      </p>
                    </button>
                  </div>

                  {secondaryPaymentMethod === 'Pix' ? (
                    <div className="rounded-xl bg-slate-950/85 border border-emeraldVip/25 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-slate-300 font-semibold">
                          Chave Pix oficial (envie o comprovante pelo WhatsApp):
                        </span>
                        {copiedBookingPix && (
                          <span className="text-emeraldVip font-bold">Chave copiada!</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-slate-900 border border-white/5 rounded-lg px-2.5 py-1.5 text-[11px] text-emeraldVip font-mono truncate">
                          {effectivePixKey}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyBookingPix}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-white inline-flex items-center gap-1 shrink-0"
                        >
                          {copiedBookingPix ? (
                            <Check className="w-3 h-3 text-emeraldVip" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {copiedBookingPix ? 'Chave copiada!' : 'Copiar Chave Pix'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-slate-950/85 border border-goldVip/25 px-3 py-2 text-[11px] text-slate-300">
                      Pagamento realizado pessoalmente na maquininha ao final da corrida (Crédito ou Débito).
                    </div>
                  )}
                </div>
              )}

              {/* Mandatory Late Cancellation Policy Warning */}
              <div className="rounded-2xl bg-amber-950/35 border border-amber-400/35 px-3.5 py-2.5 flex items-start gap-2.5 text-[11px] text-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="leading-snug">
                  <strong>Política de Cancelamento:</strong> Será cobrada uma multa de{' '}
                  <strong>{formatCurrency(LATE_CANCEL_PENALTY)}</strong> caso a viagem seja cancelada com 30 minutos ou menos de antecedência do horário agendado.
                </p>
              </div>

              {bookingError && (
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200">
                  {bookingError}
                </div>
              )}

              <button
                type="submit"
                disabled={submittingRide || !destination || hasScheduleConflict}
                className="w-full py-3.5 px-4 rounded-2xl bg-emeraldVip hover:brightness-110 text-slate-950 font-bold text-sm flex items-center justify-between shadow-lg shadow-emeraldVip/20 transition-all disabled:opacity-60"
              >
                <span className="flex items-center gap-2">
                  {submittingRide && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submittingRide
                    ? 'Confirmando Reserva...'
                    : hasScheduleConflict
                      ? 'Horário Ocupado — Escolha Outro'
                      : remainingDue <= 0
                        ? 'Confirmar (Pago via Carteira)'
                        : 'Confirmar Viagem VIP'}
                </span>
                <span className="font-display text-base font-extrabold tabular-nums">
                  {formatCurrency(totalWithPenalty)}
                </span>
              </button>
            </form>
          )}
        </div>
      </section>

      {/* MODALS */}
      <LocationSearchModal
        isOpen={searchModal.open}
        target={searchModal.target}
        biasLat={origin.lat}
        biasLng={origin.lng}
        onClose={() => setSearchModal((s) => ({ ...s, open: false }))}
        onSelectPlace={(place) => {
          if (searchModal.target === 'origin') setOrigin(place);
          else setDestination(place);
        }}
        onEnableMapPin={() => setPinDropMode(searchModal.target)}
      />

      <SuccessModal
        ride={confirmedRide}
        settings={settings}
        vipActive={Boolean(user.vipActive)}
        whatsappDispatch={confirmedWhatsapp}
        isGuest={user.isGuest}
        onClose={() => {
          setConfirmedRide(null);
          setConfirmedWhatsapp(null);
        }}
      />

      <VipClubModal
        isOpen={vipOpen}
        initialTab={vipTab}
        user={user}
        vouchers={vouchers}
        selectedVoucherCode={selectedVoucher?.voucherCode || null}
        onClose={() => setVipOpen(false)}
        onSelectVoucher={(v) => setSelectedVoucher(v)}
        onVoucherRedeemed={(voucher, newPoints) => {
          setVouchers((prev) => [voucher, ...prev]);
          setUser((u) =>
            u ? { ...u, points: newPoints, tier: getVipTier(newPoints) } : u
          );
        }}
        onUserUpdated={(updatedUser) => setUser(updatedUser)}
      />

      <HistoryModal
        isOpen={historyOpen}
        rides={rides}
        settings={settings}
        vipActive={Boolean(user.vipActive)}
        onClose={() => setHistoryOpen(false)}
        onCancelRide={handleCancelRide}
      />

      <AIConciergeModal
        isOpen={aiModal.open}
        isAdmin={isStrictAdmin}
        initialMode={aiModal.mode}
        currentLat={origin.lat}
        currentLng={origin.lng}
        onClose={() => setAiModal((s) => ({ ...s, open: false }))}
      />

      {isStrictAdmin && (
        <CreatorDashboardModal
          isOpen={dashboardOpen}
          isAdmin={isStrictAdmin}
          settings={settings}
          onClose={() => setDashboardOpen(false)}
          onSettingsUpdated={(updated) => {
            setSettings(updated);
            refreshAvailability();
          }}
          onRideStatusUpdated={() => {
            refreshBackendData();
            refreshAvailability();
          }}
          onOpenAiFinance={() => setAiModal({ open: true, mode: 'finance' })}
        />
      )}

      {!user.isGuest && (
        <OnboardingProfileModal
          isOpen={requiresOnboarding || profileModalOpen}
          mode={requiresOnboarding ? 'onboarding' : 'edit'}
          user={user}
          authNotice={requiresOnboarding ? profileSyncNotice : null}
          onClose={requiresOnboarding ? undefined : () => setProfileModalOpen(false)}
          onLogout={handleLogout}
          onProfileSaved={(updatedUser) => {
            setUser(updatedUser);
            setAuthError(null);
            setProfileSyncNotice(null);
            if (updatedUser.phone) {
              setClientPhone(updatedUser.phone);
            }
          }}
        />
      )}

      <WalletModal
        isOpen={walletOpen}
        user={user}
        pixKey={effectivePixKey}
        onClose={() => setWalletOpen(false)}
        onWalletUpdated={(balance, penalty) => {
          setUser((u) =>
            u ? { ...u, walletBalance: balance, pendingPenalty: penalty } : u
          );
        }}
      />
    </div>
  );
}
