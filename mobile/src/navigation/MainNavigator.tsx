import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeFeedScreen from '../screens/HomeFeedScreen';
import PostGigScreen from '../screens/PostGigScreen';
import FundEscrowScreen from '../screens/FundEscrowScreen';
import ReviewSignOffScreen from '../screens/ReviewSignOffScreen';
import BrowseMarketScreen from '../screens/BrowseMarketScreen';
import ClaimWorkScreen from '../screens/ClaimWorkScreen';
import LedgerScreen from '../screens/LedgerScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { BrowseStackParamList, GigStackParamList, MainTabParamList } from './types';
import { useAuth } from '../auth/AuthContext';
import { fonts } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator<MainTabParamList>();
const GigStack = createNativeStackNavigator<GigStackParamList>();
const BrowseStack = createNativeStackNavigator<BrowseStackParamList>();

function GigStackNavigator() {
  const { colors } = useTheme();
  return (
    <GigStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgApp } }}>
      <GigStack.Screen name="HomeFeed" component={HomeFeedScreen} />
      <GigStack.Screen name="PostGig" component={PostGigScreen} />
      <GigStack.Screen name="FundEscrow" component={FundEscrowScreen} />
      <GigStack.Screen name="ReviewSignOff" component={ReviewSignOffScreen} />
    </GigStack.Navigator>
  );
}

function BrowseStackNavigator() {
  const { colors } = useTheme();
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgApp } }}>
      <BrowseStack.Screen name="BrowseMarket" component={BrowseMarketScreen} />
      <BrowseStack.Screen name="ClaimWork" component={ClaimWorkScreen} />
    </BrowseStack.Navigator>
  );
}

/**
 * Tab visibility is role-driven, not a fixed set — a user can hold both
 * 'client' and 'professional' role flags (HANDOFF.md §3.1: roles are
 * flags, not a fixed enum), and whether a combined "Hybrid" account type
 * still ships in v1 is itself open (HANDOFF.md §11) — so this reads
 * user.roles directly rather than assuming a fixed three-way split.
 */
export default function MainNavigator() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const isClient = user?.roles.includes('client') ?? false;
  const isProfessional = user?.roles.includes('professional') ?? false;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.greenPrimary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11 },
      }}
    >
      {isClient ? <Tab.Screen name="Home" component={GigStackNavigator} options={{ title: 'Gigs' }} /> : null}
      {isProfessional ? (
        <Tab.Screen name="Browse" component={BrowseStackNavigator} options={{ title: 'Browse' }} />
      ) : null}
      <Tab.Screen name="Ledger" component={LedgerScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
