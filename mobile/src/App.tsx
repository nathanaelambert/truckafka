import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, Dimensions,
} from 'react-native';
import { default as RNMapView, Polyline, Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { api, getToken, setToken, clearToken, setUserData, getUserData, type Haul, type Itinerary } from './api';

const { width } = Dimensions.get('window');

type DriverStatus = 'off_duty' | 'on_duty_not_driving' | 'driving';

const STATUS_LABELS: Record<DriverStatus, string> = {
  off_duty: 'OFF-DUTY',
  on_duty_not_driving: 'ON-DUTY',
  driving: 'DRIVING',
};

const STATUS_COLORS: Record<DriverStatus, string> = {
  off_duty: '#6b7280',
  on_duty_not_driving: '#10b981',
  driving: '#f59e0b',
};

// ═══════════════════════════════════════════════════════════════
// Login Screen
// ═══════════════════════════════════════════════════════════════

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!userName || !password) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.login(userName, password);
      await setToken(result.token);
      await setUserData(result.user);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.loginContainer}>
      <Text style={styles.loginTitle}>TRUCKMAFIA</Text>
      <Text style={styles.loginSubtitle}>Driver App</Text>
      <View style={styles.loginForm}>
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor="#6b7280"
          value={userName}
          onChangeText={setUserName}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#6b7280"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
          <Text style={styles.loginButtonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hintText}>Try: driver1 / driver123</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// Status Slider
// ═══════════════════════════════════════════════════════════════

function StatusSlider({ status, onStatusChange }: {
  status: DriverStatus;
  onStatusChange: (s: DriverStatus) => void;
}) {
  const statuses: DriverStatus[] = ['off_duty', 'on_duty_not_driving', 'driving'];
  const currentIndex = statuses.indexOf(status);

  const handleSlide = (newIndex: number) => {
    const newStatus = statuses[newIndex];
    // Enforce: can't go from off_duty to driving directly
    if (status === 'off_duty' && newStatus === 'driving') {
      Alert.alert(
        'Invalid Transition',
        'You must be ON-DUTY before you can start DRIVING. Please switch to ON-DUTY first.',
        [{ text: 'OK' }]
      );
      return;
    }
    onStatusChange(newStatus);
  };

  return (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderTrack}>
        {statuses.map((s, i) => (
          <TouchableOpacity
            key={s}
            style={[
              styles.sliderSegment,
              { backgroundColor: i === currentIndex ? STATUS_COLORS[s] : '#1f2937' },
              i === 0 && { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
              i === statuses.length - 1 && { borderTopRightRadius: 8, borderBottomRightRadius: 8 },
            ]}
            onPress={() => handleSlide(i)}
          >
            <Text style={[
              styles.sliderText,
              { color: i === currentIndex ? '#0f1117' : '#6b7280' },
            ]}>
              {STATUS_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[styles.sliderKnob, { backgroundColor: STATUS_COLORS[status] }]} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// Haul Card
// ═══════════════════════════════════════════════════════════════

function HaulCard({ haul }: { haul: Haul }) {
  const formatDate = (dt: string) => {
    return new Date(dt).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  };

  return (
    <View style={styles.haulCard}>
      <View style={styles.haulHeader}>
        <Text style={styles.haulLoadNumber}>Load #{haul.load_number}</Text>
        <View style={[styles.haulStatusBadge, { backgroundColor: getStatusColor(haul.status) }]}>
          <Text style={styles.haulStatusText}>{haul.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.haulRoute}>
        <View style={styles.haulRoutePoint}>
          <View style={[styles.routeDot, { backgroundColor: '#10b981' }]} />
          <View>
            <Text style={styles.routeLabel}>PICKUP</Text>
            <Text style={styles.routeLocation}>{haul.pickup_name}</Text>
            <Text style={styles.routeTime}>{formatDate(haul.pickup_after)}</Text>
            <Text style={styles.routePhone}>📞 {haul.pickup_phone}</Text>
          </View>
        </View>
        <View style={styles.routeConnector} />
        <View style={styles.haulRoutePoint}>
          <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
          <View>
            <Text style={styles.routeLabel}>DROPOFF</Text>
            <Text style={styles.routeLocation}>{haul.dropoff_name}</Text>
            <Text style={styles.routeTime}>{formatDate(haul.dropoff_after)}</Text>
            <Text style={styles.routePhone}>📞 {haul.dropoff_phone}</Text>
          </View>
        </View>
      </View>

      <View style={styles.haulDetails}>
        <View style={styles.haulDetailRow}>
          <Text style={styles.haulDetailLabel}>Truck</Text>
          <Text style={styles.haulDetailValue}>#{haul.truck_number}</Text>
        </View>
        <View style={styles.haulDetailRow}>
          <Text style={styles.haulDetailLabel}>Trailer</Text>
          <Text style={styles.haulDetailValue}>#{haul.trailer_number}</Text>
        </View>
        <View style={styles.haulDetailRow}>
          <Text style={styles.haulDetailLabel}>Commodity</Text>
          <Text style={styles.haulDetailValue}>{haul.commodity || 'N/A'}</Text>
        </View>
        <View style={styles.haulDetailRow}>
          <Text style={styles.haulDetailLabel}>Weight</Text>
          <Text style={styles.haulDetailValue}>{haul.load_weight.toLocaleString()} kg</Text>
        </View>
        {haul.is_hazmat && (
          <View style={[styles.haulDetailRow, { backgroundColor: '#7f1d1d', borderRadius: 4, padding: 4 }]}>
            <Text style={[styles.haulDetailLabel, { color: '#fca5a5' }]}>⚠️ HAZMAT</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    draft: '#6b7280', assigned: '#3b82f6',
    in_progress: '#f59e0b', completed: '#10b981', cancelled: '#ef4444',
  };
  return colors[status] || '#6b7280';
}

// ═══════════════════════════════════════════════════════════════
// Main Driver App
// ═══════════════════════════════════════════════════════════════

function DriverApp({ onLogout }: { onLogout: () => void }) {
  const [haul, setHaul] = useState<Haul | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [status, setStatus] = useState<DriverStatus>('off_duty');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userData, setUserData] = useState<{ id: string; driver_id?: string } | null>(null);

  // Load user data and hauls
  useEffect(() => {
    (async () => {
      const user = await getUserData();
      if (!user?.driver_id) return;
      setUserData(user);
      try {
        const hauls = await api.getHauls(user.driver_id);
        // Show the first assigned or in_progress haul
        const activeHaul = hauls.find(h => ['assigned', 'in_progress'].includes(h.status)) || hauls[0];
        if (activeHaul) {
          setHaul(activeHaul);
          try {
            const itin = await api.getItinerary(activeHaul.id);
            setItinerary(itin);
          } catch { /* no itinerary yet */ }
        }
      } catch (err) {
        console.error('Failed to load hauls:', err);
      }
    })();
  }, []);

  // Location tracking when driving
  useEffect(() => {
    if (status !== 'driving') return;

    (async () => {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') return;

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
        async (loc) => {
          const { latitude, longitude, heading, speed } = loc.coords;
          setLocation({ latitude, longitude });
          if (haul?.truck_id) {
            const speedKmh = speed ? speed * 3.6 : 0;
            await api.reportPosition(haul.truck_id, latitude, longitude, heading || 0, speedKmh).catch(() => {});
          }
        }
      );
      return () => sub.remove();
    })();
  }, [status, haul]);

  const handleStatusChange = useCallback(async (newStatus: DriverStatus) => {
    if (!userData?.driver_id) return;
    try {
      await api.updateStatus(userData.driver_id, newStatus);
      setStatus(newStatus);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update status');
    }
  }, [userData]);

  const mapRegion = itinerary?.geometry?.length
    ? {
        latitude: itinerary.geometry[0].lat,
        longitude: itinerary.geometry[0].lng,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      }
    : {
        latitude: 43.5183,
        longitude: -80.55,
        latitudeDelta: 1,
        longitudeDelta: 1,
      };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TRUCKMAFIA</Text>
        <TouchableOpacity onPress={async () => { await clearToken(); onLogout(); }}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {haul ? (
          <HaulCard haul={haul} />
        ) : (
          <View style={styles.noHaulCard}>
            <Text style={styles.noHaulText}>No hauls assigned</Text>
            <Text style={styles.noHaulSubtext}>Check with dispatch for assignments</Text>
          </View>
        )}

        {/* Map */}
        {itinerary && (
          <View style={styles.mapContainer}>
            <RNMapView
              style={styles.map}
              initialRegion={mapRegion}
              showsUserLocation={status === 'driving'}
            >
              <Polyline
                coordinates={itinerary.geometry.map(p => ({
                  latitude: p.lat,
                  longitude: p.lng,
                }))}
                strokeColor="#4a9eff"
                strokeWidth={4}
              />
              {itinerary.geometry.length > 0 && (
                <>
                  <Marker coordinate={{
                    latitude: itinerary.geometry[0].lat,
                    longitude: itinerary.geometry[0].lng,
                  }} pinColor="green" />
                  <Marker coordinate={{
                    latitude: itinerary.geometry[itinerary.geometry.length - 1].lat,
                    longitude: itinerary.geometry[itinerary.geometry.length - 1].lng,
                  }} pinColor="red" />
                </>
              )}
              {location && (
                <Circle
                  center={location}
                  radius={50}
                  strokeColor="#4a9eff"
                  fillColor="rgba(74, 158, 255, 0.2)"
                />
              )}
            </RNMapView>
          </View>
        )}

        {/* HOS info */}
        {userData?.driver_id && (
          <View style={styles.hosCard}>
            <Text style={styles.hosTitle}>Hours of Service</Text>
            <Text style={styles.hosStatus} >Current: {STATUS_LABELS[status]}</Text>
          </View>
        )}
      </ScrollView>

      {/* Status slider — fixed at bottom */}
      <View style={styles.statusBar}>
        <Text style={styles.statusBarLabel}>Duty Status</Text>
        <StatusSlider status={status} onStatusChange={handleStatusChange} />
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// Root App
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) setIsLoggedIn(true);
      setChecked(true);
    })();
  }, []);

  if (!checked) return <View style={styles.container} />;

  return isLoggedIn
    ? <DriverApp onLogout={() => setIsLoggedIn(false)} />
    : <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
}

// ═══════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1117',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d3142',
  },
  headerTitle: {
    color: '#4a9eff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  logoutText: {
    color: '#8b8fa3',
    fontSize: 14,
  },
  content: {
    flex: 1,
    padding: 12,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f1117',
    padding: 24,
  },
  loginTitle: {
    color: '#4a9eff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
  },
  loginSubtitle: {
    color: '#8b8fa3',
    fontSize: 14,
    marginBottom: 32,
  },
  loginForm: {
    width: '100%',
    maxWidth: 320,
  },
  input: {
    backgroundColor: '#1a1d27',
    borderWidth: 1,
    borderColor: '#2d3142',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    color: '#e4e6eb',
    fontSize: 16,
  },
  errorText: {
    color: '#f87171',
    fontSize: 14,
    marginBottom: 12,
  },
  loginButton: {
    backgroundColor: '#2a6dcc',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hintText: {
    color: '#8b8fa3',
    fontSize: 12,
    marginTop: 24,
  },
  haulCard: {
    backgroundColor: '#1a1d27',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d3142',
  },
  haulHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  haulLoadNumber: {
    color: '#4a9eff',
    fontSize: 18,
    fontWeight: '700',
  },
  haulStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  haulStatusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  haulRoute: {
    marginBottom: 12,
  },
  haulRoutePoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  routeConnector: {
    width: 2,
    height: 24,
    backgroundColor: '#2d3142',
    marginLeft: 5,
  },
  routeLabel: {
    color: '#8b8fa3',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  routeLocation: {
    color: '#e4e6eb',
    fontSize: 14,
    fontWeight: '500',
  },
  routeTime: {
    color: '#8b8fa3',
    fontSize: 12,
  },
  routePhone: {
    color: '#8b8fa3',
    fontSize: 12,
    marginTop: 2,
  },
  haulDetails: {
    borderTopWidth: 1,
    borderTopColor: '#2d3142',
    paddingTop: 12,
  },
  haulDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  haulDetailLabel: {
    color: '#8b8fa3',
    fontSize: 13,
  },
  haulDetailValue: {
    color: '#e4e6eb',
    fontSize: 13,
    fontWeight: '500',
  },
  noHaulCard: {
    backgroundColor: '#1a1d27',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3142',
  },
  noHaulText: {
    color: '#8b8fa3',
    fontSize: 16,
    fontWeight: '600',
  },
  noHaulSubtext: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 4,
  },
  mapContainer: {
    height: 250,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d3142',
  },
  map: {
    flex: 1,
  },
  hosCard: {
    backgroundColor: '#1a1d27',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d3142',
  },
  hosTitle: {
    color: '#8b8fa3',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  hosStatus: {
    color: '#e4e6eb',
    fontSize: 16,
    fontWeight: '500',
  },
  statusBar: {
    backgroundColor: '#1a1d27',
    borderTopWidth: 1,
    borderTopColor: '#2d3142',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusBarLabel: {
    color: '#8b8fa3',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  sliderContainer: {
    position: 'relative',
  },
  sliderTrack: {
    flexDirection: 'row',
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sliderSegment: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sliderText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sliderKnob: {
    position: 'absolute',
    top: 4,
    left: width / 3 / 2 - 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
