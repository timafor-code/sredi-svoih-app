import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

type AvatarProps = {
  bg?: string;
  initials: string;
  size?: number;
  uri?: string | null;
};

export function Avatar({ bg = '#1a3a5c', initials, size = 72, uri }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUri = uri && !imageFailed ? uri : null;

  useEffect(() => {
    setImageFailed(false);
  }, [uri]);

  return (
    <View style={[styles.shell, { width: size, height: size, borderRadius: size / 2 }]}>
      {imageUri ? (
        <Image
          key={imageUri}
          onError={() => setImageFailed(true)}
          resizeMode="cover"
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFillObject}
        />
      ) : (
        <>
          <LinearGradient
            colors={[bg, 'rgba(0,0,0,0.28)']}
            style={[StyleSheet.absoluteFillObject, { borderRadius: size / 2 }]}
          />
          <Text style={[styles.initials, { fontSize: Math.round(size * 0.32) }]}>
            {initials}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  initials: {
    color: '#fff',
    fontWeight: '700',
    includeFontPadding: false,
  },
});
