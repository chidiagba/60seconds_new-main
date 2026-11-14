import AvatarImage from '@/components/AvatarImage';
import { logger } from '@/lib/logger';
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useActionSheet } from "@expo/react-native-action-sheet";
import {
  Camera,
  Save,
  MapPin,
  Tag,
  Briefcase,
  ArrowLeft,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useAuth } from "@/lib/auth";
import { uploadImageToSupabase } from "@/utils/image-upload";
import { useVideoStore } from "@/store/video-store";
import { resolveAvatarUrl } from "@/utils/avatar";

const PLACEHOLDER_AVATAR_URL = "https://via.placeholder.com/150";

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showActionSheetWithOptions } = useActionSheet();
  const { user, profile, updateProfile } = useAuth();
  const syncUserProfile = useVideoStore((state) => state.syncUserProfile);

  const [avatar, setAvatar] = useState(PLACEHOLDER_AVATAR_URL);
  const [avatarGender, setAvatarGender] = useState<'male' | 'female' | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [eventCategories, setEventCategories] = useState("");
  const [walletId, setWalletId] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Load real user data from Supabase
  useEffect(() => {
    logger.debug('🔍 Edit Profile - Profile data received:', profile);
    logger.debug('🔍 Edit Profile - User data received:', user);
    
    if (profile) {
      logger.debug('✅ Loading profile data into form fields');
      const nextAvatarGender = (profile as any).avatar_gender ?? null;
      setAvatarGender(nextAvatarGender);
      setAvatar(
        resolveAvatarUrl({
          avatarUrl: profile.avatar_url,
          avatarGender: nextAvatarGender,
          fallbackUrl: PLACEHOLDER_AVATAR_URL,
        })
      );
      setDisplayName(profile.full_name || "");
      setUsername(profile.username || "");
      setBio(profile.bio || "");
      setLocation(profile.location_city || "");
      setBusinessName(profile.business_name || "");
      setBusinessType(profile.business_type || "");
      setEventCategories(profile.hashtags?.join(", ") || "");
      setHashtags(profile.hashtags?.map(tag => `#${tag}`).join(" ") || "");
      
      logger.debug('✅ Form fields set:');
      logger.debug('  - Display Name:', profile.full_name);
      logger.debug('  - Username:', profile.username);
      logger.debug('  - Business Name:', profile.business_name);
      logger.debug('  - Business Type:', profile.business_type);
    } else {
      logger.debug('❌ No profile data available');
    }
  }, [profile, user]);

  const handleSave = async () => {
    if (!user || !profile) {
      logger.error('No user or profile data available');
      return;
    }

    setIsLoading(true);
    try {
      // Prepare update data
      const updateData = {
        full_name: displayName,
        username: username,
        bio: bio,
        location_city: location,
        business_name: businessName,
        business_type: businessType,
        hashtags: hashtags.split(' ').filter(tag => tag.startsWith('#')).map(tag => tag.substring(1)),
        avatar_url: avatarGender
          ? null
          : avatar && avatar !== PLACEHOLDER_AVATAR_URL
            ? avatar
            : null,
        avatar_gender: null,
      } as any;

      logger.debug('Updating profile with data:', updateData);

      const { error } = await updateProfile(updateData);
      if (error) {
        throw error;
      }

      syncUserProfile(user.id, {
        name: updateData.full_name,
        displayName: updateData.full_name,
        username: updateData.username,
        avatar: resolveAvatarUrl({
          avatarUrl: updateData.avatar_url,
          avatarGender: updateData.avatar_gender,
        }),
        bio: updateData.bio,
        businessName: updateData.business_name,
        businessType: updateData.business_type,
      });

      router.back();
    } catch (error) {
      logger.error('Error updating profile:', error);
      // You could show an error alert here
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = () => {
    const options = ["Take Photo", "Choose from Library", "Cancel"];
    const cancelButtonIndex = 2;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
        title: "Change Profile Picture",
      },
      async (buttonIndex) => {
        if (buttonIndex === 0) {
          // Take Photo
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (perm.status !== "granted") {
            alert("Camera permission is required.");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
          if (!result.canceled && user) {
            await uploadImage(result.assets[0].uri);
          }
        } else if (buttonIndex === 1) {
          // Choose from Library
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
          if (!result.canceled && user) {
            await uploadImage(result.assets[0].uri);
          }
        }
      }
    );
  };

  const uploadImage = async (imageUri: string) => {
    if (!user) {
      logger.error('No user available for image upload');
      return;
    }

    try {
      setIsLoading(true);
      logger.debug('🔄 Starting image upload...');
      
      // Upload image to Supabase storage
      const publicUrl = await uploadImageToSupabase(imageUri, user.id, 'avatars');
      logger.debug('✅ Image uploaded successfully:', publicUrl);
      
      // Update avatar state immediately in the editor screen.
      setAvatar(publicUrl);
      setAvatarGender(null);

      // Persist immediately so every screen reading the profile gets the new avatar.
      const { error } = await updateProfile({ avatar_url: publicUrl, avatar_gender: null } as any);
      if (error) {
        throw error;
      }

      // Update already-loaded feed/comment caches so the new avatar shows without refetching.
      syncUserProfile(user.id, { avatar: publicUrl });
      
    } catch (error) {
      logger.error('❌ Error uploading image:', error);
      alert('Failed to upload image. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  };

  return (
    <View style={{flex:1}}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <KeyboardAwareScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: Math.max(80, insets.bottom + 60) }}
        enableOnAndroid={true}
        extraScrollHeight={60}
        keyboardShouldPersistTaps="handled"
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={{ paddingBottom: Math.max(110, insets.bottom + 80) }}
          keyboardShouldPersistTaps="handled"
        >

          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <AvatarImage uri={avatar} style={styles.avatar} />
            <TouchableOpacity style={styles.cameraButton} onPress={pickImage}>
              <Camera size={18} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>

          {/* Form Fields */}
          <FormField
            label="Display Name"
            value={displayName}
            setValue={setDisplayName}
          />
          <FormField label="Username" value={username} setValue={setUsername} />
          <FormField label="Bio" value={bio} setValue={setBio} multiline />
          <FormField
            label="Location"
            value={location}
            setValue={setLocation}
            icon={<MapPin size={18} color={Colors.dark.subtext} />}
          />
          <FormField
            label="Event Categories"
            value={eventCategories}
            setValue={setEventCategories}
            icon={<Briefcase size={18} color={Colors.dark.subtext} />}
          />
          <FormField
            label="Wallet ID"
            value={walletId}
            setValue={setWalletId}
          />
          <FormField
            label="Favorite Hashtags"
            value={hashtags}
            setValue={setHashtags}
            icon={<Tag size={18} color={Colors.dark.subtext} />}
          />

          {/* Business Account Fields - Only show for business accounts */}
          {profile?.user_type === 'business' && (
            <>
              <View style={styles.sectionDivider} />
              <Text style={styles.sectionTitle}>Business Information</Text>
              
              <FormField
                label="Business Name"
                value={businessName}
                setValue={setBusinessName}
                icon={<Briefcase size={18} color={Colors.dark.subtext} />}
              />
              
              <FormField
                label="Business Type"
                value={businessType}
                setValue={setBusinessType}
                icon={<Briefcase size={18} color={Colors.dark.subtext} />}
              />
            </>
          )}

          {/* Save Button */}
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <LinearGradient
              colors={
                Colors.dark.gradients.primary as [string, string, ...string[]]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientButton}
            >
              <Save
                size={18}
                color={Colors.dark.text}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAwareScrollView>
    </View>
  );
}

function FormField({ label, value, setValue, multiline = false, icon = null }: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  multiline?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <View style={styles.formGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputIconRow}>
        {icon && <View style={{ marginRight: 8 }}>{icon}</View>}
        <TextInput
          style={[
            styles.input,
            {
              flex: 1,
              height: multiline ? 80 : 44,
              textAlignVertical: multiline ? "top" : "center",
            },
          ]}
          value={value}
          onChangeText={setValue}
          placeholder={`Enter ${label.toLowerCase()}`}
          placeholderTextColor={Colors.dark.subtext}
          multiline={multiline}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    paddingHorizontal: 10,
  },

  header: {
    marginTop: 50,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  avatarContainer: {
    alignSelf: "center",
    position: "relative",
    marginBottom: 24,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: Colors.dark.primary,
  },
  cameraButton: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    padding: 6,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
    color: Colors.dark.text,
    // borderWidth: 1,
    // borderColor: Colors.dark.divider,
  },
  inputIconRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  saveButton: {
    marginTop: 24,
    borderRadius: 12,
    overflow: "hidden",
  },
  gradientButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  saveButtonText: {
    color: Colors.dark.text,
    fontWeight: "600",
    fontSize: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: Colors.dark.divider,
    marginVertical: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: 16,
  },
  genderPickerContainer: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: -8,
  },
  genderPickerLabel: {
    color: Colors.dark.subtext,
    fontSize: 13,
    marginBottom: 8,
  },
  genderPickerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  genderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  genderBtnActive: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(99,102,241,0.15)',
  },
  genderBtnText: {
    color: Colors.dark.subtext,
    fontSize: 13,
    fontWeight: '500',
  },
  genderBtnTextActive: {
    color: Colors.dark.primary,
  },
});
