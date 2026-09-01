import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

export function Screen({ children, style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={[styles.screen, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function Heading({ children, style }: { children: React.ReactNode; style?: object }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Subtext({ children, style, onPress }: { children: React.ReactNode; style?: object; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Text style={[styles.subtext, style]} onPress={onPress}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: object;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Text style={[styles.body, style]} onPress={onPress}>
      {children}
    </Text>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'destructive' && styles.buttonDestructive,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.greenPrimary : '#fff'} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && styles.buttonTextSecondary,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  style,
  ...rest
}: TextInputProps & { label?: string; error?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.banner, tone === 'warning' && styles.bannerWarning]}>
      <Text style={styles.bannerText}>{children}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'active' | 'error' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.pill, tone === 'active' && styles.pillActive, tone === 'error' && styles.pillError]}>
      <Text
        style={[
          styles.pillText,
          tone === 'active' && styles.pillTextActive,
          tone === 'error' && styles.pillTextError,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.bgApp },
    screen: { flex: 1, backgroundColor: colors.bgApp, padding: spacing.xl },
    heading: {
      fontFamily: fonts.serifBold,
      fontSize: fontSizes.xxl,
      color: colors.textPrimary,
      marginBottom: spacing.xs,
    },
    subtext: {
      fontFamily: fonts.sans,
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      marginBottom: spacing.lg,
    },
    body: {
      fontFamily: fonts.sans,
      fontSize: fontSizes.base,
      color: colors.textBody,
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.cardLg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
    },
    button: {
      backgroundColor: colors.greenPrimary,
      borderRadius: radii.button,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonSecondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    buttonDestructive: { backgroundColor: colors.error },
    buttonPressed: { backgroundColor: colors.greenDeep },
    buttonDisabled: { opacity: 0.5 },
    buttonText: {
      fontFamily: fonts.sansSemiBold,
      fontSize: fontSizes.md,
      color: '#fff',
    },
    buttonTextSecondary: { color: colors.greenPrimary },
    fieldWrap: { marginBottom: spacing.lg },
    fieldLabel: {
      fontFamily: fonts.sansMedium,
      fontSize: fontSizes.sm,
      color: colors.textBody,
      marginBottom: spacing.xs,
    },
    input: {
      fontFamily: fonts.sans,
      fontSize: fontSizes.md,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    inputError: { borderColor: colors.error },
    fieldError: {
      fontFamily: fonts.sans,
      fontSize: fontSizes.xs,
      color: colors.error,
      marginTop: spacing.xs,
    },
    banner: {
      backgroundColor: colors.bgApp,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.cardSm,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    bannerWarning: { backgroundColor: colors.errorBg, borderColor: colors.error },
    bannerText: {
      fontFamily: fonts.sans,
      fontSize: fontSizes.sm,
      color: colors.textBody,
      lineHeight: 18,
    },
    pill: {
      backgroundColor: colors.bgApp,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      alignSelf: 'flex-start',
    },
    pillActive: { backgroundColor: colors.greenMintBg, borderColor: colors.greenBright },
    pillError: { backgroundColor: colors.errorBg, borderColor: colors.error },
    pillText: {
      fontFamily: fonts.sansMedium,
      fontSize: fontSizes.xs,
      color: colors.textBody,
    },
    pillTextActive: { color: colors.greenDeep },
    pillTextError: { color: colors.error },
  });
}
