import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, Alert, FlatList } from 'react-native';
import { X, Camera, Image as ImageIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase'; // Ensure Supabase client is correctly set up
import { resolveCurrencyFromCountry } from '@/utils/country-currency';
import { EXTENDED_CURRENCY_LIST } from '@/constants/currencies';

interface Product {
  name: string;
  price: number;
  available_quantity: number;
  image?: string;
  currency: string;
  ownerId: string;
}

interface ProductCreationModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
  offeringType?: 'ticket' | 'drink' | 'other';
  modalTitle?: string;
  defaultCurrency?: string;
  initialProduct?: Partial<Product> | null;
  submitLabel?: string;
}

export function ProductCreationModal({
  visible,
  onClose,
  onSave,
  offeringType,
  modalTitle,
  defaultCurrency,
  initialProduct,
  submitLabel,
}: ProductCreationModalProps) {
  const resolvedTitle = modalTitle
    ?? (offeringType === 'ticket' ? '🎫 Add Ticket'
      : offeringType === 'drink' ? '🍹 Add Drink'
      : offeringType === 'other' ? '✨ Add Other Offer'
      : 'Add Offering');
  const [name, setName] = useState(initialProduct?.name || '');
  const [price, setPrice] = useState(initialProduct?.price != null ? String(initialProduct.price) : '');
  const [quantity, setQuantity] = useState(
    initialProduct?.available_quantity != null ? String(initialProduct.available_quantity) : ''
  );
  const [imageUri, setImageUri] = useState<string | null>(initialProduct?.image || null);
  const [errors, setErrors] = useState<string[]>([]);
  const [resolvedCurrency, setResolvedCurrency] = useState(
    (initialProduct?.currency || defaultCurrency || 'USD').toUpperCase()
  );
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
  const [eventOwnerId, setEventOwnerId] = useState<string | null>(null); // Store logged-in user's UUID

  useEffect(() => {
    if (!visible) {
      return;
    }

    setName(initialProduct?.name || '');
    setPrice(initialProduct?.price != null ? String(initialProduct.price) : '');
    setQuantity(initialProduct?.available_quantity != null ? String(initialProduct.available_quantity) : '');
    setImageUri(initialProduct?.image || null);
    setErrors([]);
    setResolvedCurrency((initialProduct?.currency || defaultCurrency || 'USD').toUpperCase());
  }, [defaultCurrency, initialProduct, visible]);

  // Fetch the logged-in user's data to get the eventOwnerId (UUID)
  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;

    const fetchUserData = async () => {
      const { data, error } = await supabase.auth.getUser();
      const authUser = data?.user;
    
      if (error || !authUser) {
        Alert.alert('Not Logged In', 'You must be logged in to add products');
        return;
      }
    
      setEventOwnerId(authUser.id);

      if (initialProduct?.currency) {
        setResolvedCurrency(initialProduct.currency.toUpperCase());
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('country, country_code')
        .eq('id', authUser.id)
        .maybeSingle();

      const currency = resolveCurrencyFromCountry({
        country: profile?.country || authUser.user_metadata?.country,
        countryCode: profile?.country_code || authUser.user_metadata?.country_code,
        fallbackCurrency: defaultCurrency || 'USD',
      });

      if (!cancelled) {
        setResolvedCurrency(currency);
      }
    };

    void fetchUserData();

    return () => {
      cancelled = true;
    };
  }, [defaultCurrency, initialProduct?.currency, visible]);

  const handleSave = () => {
    const validationErrors: string[] = [];

    if (!name.trim()) {
      validationErrors.push('Product name is required');
    }
    if (!price || parseFloat(price) <= 0) {
      validationErrors.push('Valid price is required');
    }
    if (!quantity || parseInt(quantity) < 0) {
      validationErrors.push('Valid quantity is required');
    }
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const product: Product = {
      name: name.trim(),
      price: parseFloat(price),
      available_quantity: parseInt(quantity),
      image: imageUri || undefined,
      currency: resolvedCurrency,
      ownerId: eventOwnerId || '', // Owner ID is no longer required for validation
    };

    onSave(product);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setPrice('');
    setQuantity('');
    setImageUri(null);
    setErrors([]);
    setIsCurrencyModalVisible(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleImagePicker = () => {
    Alert.alert(
      'Select Image',
      'Choose how you want to add a product image',
      [
        { text: 'Camera', onPress: openCamera },
        { text: 'Gallery', onPress: openGallery },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const openCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is required to take photos');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
    }
  };

  const openGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Gallery permission is required to select images');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
    }
  };

  const removeImage = () => {
    setImageUri(null);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <X size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{resolvedTitle}</Text>
          <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>{submitLabel || 'Save'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {errors.length > 0 && (
            <View style={styles.errorContainer}>
              {errors.map((error, index) => (
                <Text key={index} style={styles.errorText}>• {error}</Text>
              ))}
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Product Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter product name"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Price ({resolvedCurrency}) *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0.00"
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Available Quantity *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Currency *</Text>
            <TouchableOpacity
              style={styles.currencyPickerButton}
              onPress={() => setIsCurrencyModalVisible(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.currencyValue}>{resolvedCurrency}</Text>
              <Text style={styles.currencyChevron}>▼</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Product Image</Text>
            {imageUri ? (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: imageUri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
                  <X size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.imagePickerButton} onPress={handleImagePicker}>
                <ImageIcon size={24} color={Colors.dark.primary} />
                <Text style={styles.imagePickerText}>Add Product Image</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <Modal
        visible={isCurrencyModalVisible}
        animationType="slide"
        onRequestClose={() => setIsCurrencyModalVisible(false)}
      >
        <View style={styles.currencyModal}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setIsCurrencyModalVisible(false)} style={styles.closeButton}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Select Currency</Text>
            <View style={styles.closeButton} />
          </View>

          <FlatList
            data={EXTENDED_CURRENCY_LIST}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => {
              const isSelected = item.code === resolvedCurrency;
              return (
                <TouchableOpacity
                  style={styles.currencyItem}
                  onPress={() => {
                    setResolvedCurrency(item.code);
                    setIsCurrencyModalVisible(false);
                  }}
                >
                  <View style={styles.currencyItemRow}>
                    <Text style={[styles.currencyText, isSelected && styles.currencyTextSelected]}>
                      {item.code}
                    </Text>
                    <Text style={[styles.currencyItemName, isSelected && styles.currencyTextSelected]}>
                      {item.name}
                    </Text>
                    {isSelected && <Text style={styles.currencyCheckmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.dark.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  closeButton: {
    padding: 8,
  },
  saveButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  errorContainer: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#f44336',
  },
  errorText: {
    color: '#f44336',
    fontSize: 14,
    marginBottom: 4,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    color: Colors.dark.text,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  currencyValue: {
    color: Colors.dark.text,
    fontSize: 16,
  },
  currencyPickerButton: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currencyChevron: {
    color: Colors.dark.primary,
    fontSize: 12,
  },
  imagePickerButton: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    borderStyle: 'dashed',
  },
  imagePickerText: {
    color: Colors.dark.primary,
    fontSize: 14,
    marginTop: 8,
    fontWeight: '500',
  },
  imagePreviewContainer: {
    position: 'relative',
    alignSelf: 'center',
  },
  imagePreview: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#ff3b30',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencyModal: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    padding: 20,
  },
  currencyItem: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  currencyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencyText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.text,
    width: 52,
  },
  currencyItemName: {
    fontSize: 15,
    color: Colors.dark.subtext,
    flex: 1,
  },
  currencyCheckmark: {
    fontSize: 16,
    color: Colors.dark.primary,
    marginLeft: 8,
  },
  currencyTextSelected: {
    color: Colors.dark.primary,
    fontWeight: '600',
  },
});













// import React, { useState, useEffect } from 'react';
// import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet, Alert } from 'react-native';
// import { X, Camera, Image as ImageIcon } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import * as ImagePicker from 'expo-image-picker';
// import Colors from '@/constants/colors';
// import { supabase } from '@/lib/supabase'; // Ensure Supabase client is correctly set up

// interface Product {
//   name: string;
//   price: number;
//   available_quantity: number;
//   image?: string;
//   currency: string;
//   ownerId: string;
// }

// interface ProductCreationModalProps {
//   visible: boolean;
//   onClose: () => void;
//   onSave: (product: Product) => void;
// }

// export function ProductCreationModal({ visible, onClose, onSave }: ProductCreationModalProps) {
//   const [name, setName] = useState('');
//   const [price, setPrice] = useState('');
//   const [quantity, setQuantity] = useState('');
//   const [imageUri, setImageUri] = useState<string | null>(null);
//   const [errors, setErrors] = useState<string[]>([]);
//   const [currency, setCurrency] = useState('');
//   const [userCurrency, setUserCurrency] = useState('');
//   const [currencies, setCurrencies] = useState<string[]>([]);
//   const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
//   const [eventOwnerId, setEventOwnerId] = useState<string | null>(null); // Store logged-in user's UUID

//   // Fetch the logged-in user's data to get the eventOwnerId (UUID)
//   useEffect(() => {
//     const fetchUserData = async () => {
//       const { data: user, error } = await supabase.auth.getUser(); // Destructure the response
    
//       if (error || !user) {
//         Alert.alert('Not Logged In', 'You must be logged in to add products');
//         return;
//       }
    
//       setEventOwnerId(user.id); // Set the logged-in user's UUID as the eventOwnerId
//       const country = user.user_metadata?.country; // Optional chaining for user_metadata
//       if (country) {
//         setUserCurrency(getCurrencyByCountry(country)); // Use the country if available
//       } else {
//         // Fallback to IP-based country detection if country is not available in user_metadata
//         const country = await getUserCountry();
//         setUserCurrency(getCurrencyByCountry(country));
//       }
//       setCurrencies(getCurrencyList()); // Set available currencies
//     };

//     fetchUserData();
//   }, []);

//   const handleSave = () => {
//     const validationErrors: string[] = [];

//     if (!name.trim()) {
//       validationErrors.push('Product name is required');
//     }
//     if (!price || parseFloat(price) <= 0) {
//       validationErrors.push('Valid price is required');
//     }
//     if (!quantity || parseInt(quantity) < 0) {
//       validationErrors.push('Valid quantity is required');
//     }
//     if (!currency) {
//       validationErrors.push('Currency is required');
//     }
//     if (!eventOwnerId) {
//       validationErrors.push('Owner ID is required'); // Ensure eventOwnerId is present
//     }

//     if (validationErrors.length > 0) {
//       setErrors(validationErrors);
//       return;
//     }

//     const product: Product = {
//       name: name.trim(),
//       price: parseFloat(price),
//       available_quantity: parseInt(quantity),
//       image: imageUri || undefined,
//       currency,
//       ownerId: eventOwnerId, // Ensure the ownerId is included
//     };

//     onSave(product);  // Save the product
//     resetForm();
//   };

//   const resetForm = () => {
//     setName('');
//     setPrice('');
//     setQuantity('');
//     setImageUri(null);
//     setCurrency('');
//     setErrors([]);
//   };

//   const handleClose = () => {
//     resetForm();
//     onClose();
//   };

//   const handleImagePicker = () => {
//     Alert.alert(
//       'Select Image',
//       'Choose how you want to add a product image',
//       [
//         { text: 'Camera', onPress: openCamera },
//         { text: 'Gallery', onPress: openGallery },
//         { text: 'Cancel', style: 'cancel' }
//       ]
//     );
//   };

//   const openCamera = async () => {
//     const { status } = await ImagePicker.requestCameraPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Camera permission is required to take photos');
//       return;
//     }

//     const result = await ImagePicker.launchCameraAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const openGallery = async () => {
//     const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Gallery permission is required to select images');
//       return;
//     }

//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const removeImage = () => {
//     setImageUri(null);
//   };

//   const getCurrencyByCountry = (country: string) => {
//     const countryCurrencyMap: { [key: string]: string } = {
//       "USA": "USD",
//       "India": "INR",
//       "UK": "GBP",
//       "Canada": "CAD",
//     };
//     return countryCurrencyMap[country] || 'USD';
//   };

//   const getCurrencyList = () => {
//     return [
//       "USD", "INR", "GBP", "AUD", "CAD", "EUR", "JPY",
//     ];
//   };

//   const handleCurrencySelect = (currency: string) => {
//     setCurrency(currency);
//     setIsCurrencyModalVisible(false);
//   };

//   const getUserCountry = async () => {
//     try {
//       const response = await fetch('https://api.ipapi.com/api/check?access_key=YOUR_ACCESS_KEY');
//       const data = await response.json();
//       return data.country_name;
//     } catch (error) {
//       console.error('Error fetching user country:', error);
//       return 'USA';
//     }
//   };

//   return (
//     <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
//       <View style={styles.container}>
//         <View style={styles.header}>
//           <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
//             <X size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Text style={styles.title}>Add Product</Text>
//           <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
//             <Text style={styles.saveButtonText}>Save</Text>
//           </TouchableOpacity>
//         </View>

//         <View style={styles.content}>
//           {errors.length > 0 && (
//             <View style={styles.errorContainer}>
//               {errors.map((error, index) => (
//                 <Text key={index} style={styles.errorText}>• {error}</Text>
//               ))}
//             </View>
//           )}

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Name *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="Enter product name"
//               value={name}
//               onChangeText={setName}
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Price ({userCurrency}) *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0.00"
//               value={price}
//               onChangeText={setPrice}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Available Quantity *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0"
//               value={quantity}
//               onChangeText={setQuantity}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Currency *</Text>
//             <TouchableOpacity onPress={() => setIsCurrencyModalVisible(true)}>
//               <Text style={styles.textInput}>{currency || userCurrency}</Text>
//             </TouchableOpacity>
//           </View>

//           <Modal visible={isCurrencyModalVisible} animationType="slide" onRequestClose={() => setIsCurrencyModalVisible(false)}>
//             <View style={styles.currencyModal}>
//               <FlatList
//                 data={currencies}
//                 keyExtractor={(item) => item}
//                 renderItem={({ item }) => (
//                   <TouchableOpacity style={styles.currencyItem} onPress={() => handleCurrencySelect(item)}>
//                     <Text style={styles.currencyText}>{item}</Text>
//                   </TouchableOpacity>
//                 )}
//               />
//             </View>
//           </Modal>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Image</Text>
//             {imageUri ? (
//               <View style={styles.imagePreviewContainer}>
//                 <Image source={{ uri: imageUri }} style={styles.imagePreview} />
//                 <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
//                   <X size={16} color="#fff" />
//                 </TouchableOpacity>
//               </View>
//             ) : (
//               <TouchableOpacity style={styles.imagePickerButton} onPress={handleImagePicker}>
//                 <ImageIcon size={24} color={Colors.dark.primary} />
//                 <Text style={styles.imagePickerText}>Add Product Image</Text>
//               </TouchableOpacity>
//             )}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     paddingVertical: 16,
//     backgroundColor: Colors.dark.card,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: '600',
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     padding: 8,
//   },
//   saveButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 8,
//   },
//   saveButtonText: {
//     fontSize: 16,
//     color: '#fff',
//     fontWeight: '600',
//   },
//   content: {
//     flex: 1,
//     padding: 20,
//   },
//   errorContainer: {
//     backgroundColor: 'rgba(244, 67, 54, 0.1)',
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 16,
//     borderLeftWidth: 4,
//     borderLeftColor: '#f44336',
//   },
//   errorText: {
//     color: '#f44336',
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   imagePickerButton: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 20,
//     alignItems: 'center',
//     justifyContent: 'center',
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//     borderStyle: 'dashed',
//   },
//   imagePickerText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     marginTop: 8,
//     fontWeight: '500',
//   },
//   imagePreviewContainer: {
//     position: 'relative',
//     alignSelf: 'center',
//   },
//   imagePreview: {
//     width: 120,
//     height: 120,
//     borderRadius: 8,
//   },
//   removeImageButton: {
//     position: 'absolute',
//     top: -8,
//     right: -8,
//     backgroundColor: '#ff3b30',
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   currencyModal: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     padding: 20,
//   },
//   currencyItem: {
//     paddingVertical: 15,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   currencyText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//   },
// });















/////////////////////////     13    jan    2026   ///////////////////////////////////////



// import React, { useState, useEffect } from 'react';
// import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet, Alert } from 'react-native';
// import { X, Camera, Image as ImageIcon } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import * as ImagePicker from 'expo-image-picker';
// import Colors from '@/constants/colors';
// import { supabase } from '@/lib/supabase'; // Ensure Supabase client is correctly set up

// interface Product {
//   name: string;
//   price: number;
//   available_quantity: number;
//   image?: string;
//   currency: string;
// }

// interface ProductCreationModalProps {
//   visible: boolean;
//   onClose: () => void;
//   onSave: (product: Product) => void;
//   eventOwnerId: string;
// }

// export function ProductCreationModal({ visible, onClose, onSave, eventOwnerId }: ProductCreationModalProps) {
//   const [name, setName] = useState('');
//   const [price, setPrice] = useState('');
//   const [quantity, setQuantity] = useState('');
//   const [imageUri, setImageUri] = useState<string | null>(null);
//   const [errors, setErrors] = useState<string[]>([]);
//   const [currency, setCurrency] = useState('');
//   const [userCurrency, setUserCurrency] = useState('');
//   const [currencies, setCurrencies] = useState<string[]>([]);
//   const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);

//   const handleSave = () => {
//     const validationErrors: string[] = [];

//     if (!name.trim()) {
//       validationErrors.push('Product name is required');
//     }
//     if (!price || parseFloat(price) <= 0) {
//       validationErrors.push('Valid price is required');
//     }
//     if (!quantity || parseInt(quantity) < 0) {
//       validationErrors.push('Valid quantity is required');
//     }
//     if (!currency) {
//       validationErrors.push('Currency is required');
//     }

//     if (validationErrors.length > 0) {
//       setErrors(validationErrors);
//       return;
//     }

//     const product: Product = {
//       name: name.trim(),
//       price: parseFloat(price),
//       available_quantity: parseInt(quantity),
//       image: imageUri || undefined,
//       currency,
//     };

//     onSave(product);
//     resetForm();
//   };

//   const resetForm = () => {
//     setName('');
//     setPrice('');
//     setQuantity('');
//     setImageUri(null);
//     setCurrency('');
//     setErrors([]);
//   };

//   const handleClose = () => {
//     resetForm();
//     onClose();
//   };

//   const handleImagePicker = () => {
//     Alert.alert(
//       'Select Image',
//       'Choose how you want to add a product image',
//       [
//         { text: 'Camera', onPress: openCamera },
//         { text: 'Gallery', onPress: openGallery },
//         { text: 'Cancel', style: 'cancel' }
//       ]
//     );
//   };

//   const openCamera = async () => {
//     const { status } = await ImagePicker.requestCameraPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Camera permission is required to take photos');
//       return;
//     }

//     const result = await ImagePicker.launchCameraAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const openGallery = async () => {
//     const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Gallery permission is required to select images');
//       return;
//     }

//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const removeImage = () => {
//     setImageUri(null);
//   };

//   // Fetch the logged-in user's data and currencies
//   useEffect(() => {
//     const fetchUserData = async () => {
//       const user = await supabase.auth.getUser();
//       if (user.data) {
//         if (user.data.id === eventOwnerId) {
//           // Fetch user country from metadata or another source
//           const country = user.data.user_metadata?.country; // Assume country is in metadata
//           if (country) {
//             setUserCurrency(getCurrencyByCountry(country));
//           } else {
//             // Fallback to IP-based method
//             const country = await getUserCountry();
//             setUserCurrency(getCurrencyByCountry(country));
//           }
//           setCurrencies(getCurrencyList()); // Set the list of currencies
//         }
//       } else {
//         Alert.alert('Not Logged In', 'You must be logged in to add products');
//       }
//     };

//     fetchUserData();
//   }, [eventOwnerId]);

//   // const getCurrencyByCountry = (country: string) => {
//   //   const countryCurrencyMap: { [key: string]: string } = {
//   //     "USA": "USD",
//   //     "India": "INR",
//   //     "UK": "GBP",
//   //     "Canada": "CAD",
//   //     // Add other countries and their currencies here
//   //   };
//   //   return countryCurrencyMap[country] || 'USD';
//   // };

//   // const getCurrencyList = () => {
//   //   return [
//   //     "USD", "INR", "GBP", "AUD", "CAD", "EUR", "JPY", // Add more currencies
//   //   ];
//   // };


//   const getCurrencyByCountry = (country: string) => {
//     const countryCurrencyMap: { [key: string]: string } = {
//       "Afghanistan": "AFN", "Albania": "ALL", "Algeria": "DZD", "Andorra": "EUR", "Angola": "AOA", 
//       "Antigua and Barbuda": "XCD", "Argentina": "ARS", "Armenia": "AMD", "Australia": "AUD", "Austria": "EUR",
//       "Azerbaijan": "AZN", "Bahamas": "BSD", "Bahrain": "BHD", "Bangladesh": "BDT", "Barbados": "BBD", 
//       "Belarus": "BYN", "Belgium": "EUR", "Belize": "BZD", "Benin": "CFA", "Bhutan": "BTN", "Bolivia": "BOB", 
//       "Bosnia and Herzegovina": "BAM", "Botswana": "BWP", "Brazil": "BRL", "Brunei": "BND", "Bulgaria": "BGN", 
//       "Burkina Faso": "BF", "Burundi": "BIF", "Cabo Verde": "CVE", "Cambodia": "KHR", "Cameroon": "CDF", 
//       "Canada": "CAD", "Central African Republic": "CDF", "Chad": "CDF", "Chile": "CLP", "China": "CNY", 
//       "Colombia": "COP", "Comoros": "COM", "Congo, Democratic Republic of the": "CDF", "Congo, Republic of the": "CDF", 
//       "Costa Rica": "CRC", "Croatia": "HRK", "Cuba": "CUP", "Cyprus": "CYP", "Czech Republic": "CZK", 
//       "Denmark": "DKK", "Djibouti": "DJF", "Dominica": "XCD", "Dominican Republic": "DOP", "Ecuador": "USD", 
//       "Egypt": "EGP", "El Salvador": "SVC", "Equatorial Guinea": "GNF", "Eritrea": "ERN", "Estonia": "EEK", 
//       "Eswatini": "SZL", "Ethiopia": "ETB", "Fiji": "FJD", "Finland": "EUR", "France": "EUR", "Gabon": "GAB", 
//       "Gambia": "GMD", "Georgia": "GEL", "Germany": "EUR", "Ghana": "GHS", "Greece": "EUR", "Grenada": "GRD", 
//       "Guatemala": "GTQ", "Guinea": "GNF", "Guinea-Bissau": "GNF", "Guyana": "GYD", "Haiti": "HTG", 
//       "Honduras": "HNL", "Hungary": "HUF", "Iceland": "ISK", "India": "INR", "Indonesia": "IDR", 
//       "Iran": "IRR", "Iraq": "IQD", "Ireland": "EUR", "Israel": "ILS", "Italy": "EUR", "Jamaica": "JMD",
//       "Japan": "JPY", "Jordan": "JOD", "Kazakhstan": "KZT", "Kenya": "KES", "Kiribati": "AUD", "Korea, North": "KPW", 
//       "Korea, South": "KRW", "Kuwait": "KWD", "Kyrgyzstan": "KGS", "Laos": "LAK", "Latvia": "LVL", 
//       "Lebanon": "LBP", "Lesotho": "LSL", "Liberia": "LRD", "Libya": "LYD", "Liechtenstein": "CHF", 
//       "Lithuania": "EUR", "Luxembourg": "EUR", "Madagascar": "MGA", "Malawi": "MWK", "Malaysia": "MYR", 
//       "Maldives": "MVR", "Mali": "CFA", "Malta": "EUR", "Marshall Islands": "USD", "Mauritania": "MRO", 
//       "Mauritius": "MUR", "Mexico": "MXN", "Micronesia": "USD", "Moldova": "MDL", "Monaco": "EUR", 
//       "Mongolia": "MNT", "Montenegro": "EUR", "Morocco": "MAD", "Mozambique": "MZN", "Myanmar": "MMK",
//       "Namibia": "NAD", "Nauru": "AUD", "Nepal": "NPR", "Netherlands": "EUR", "New Zealand": "NZD", 
//       "Nicaragua": "NIO", "Niger": "CFA", "Nigeria": "NGN", "North Macedonia": "MKD", "Norway": "NOK", 
//       "Oman": "OMR", "Pakistan": "PKR", "Palau": "USD", "Panama": "PAB", "Papua New Guinea": "PGK", 
//       "Paraguay": "PYG", "Peru": "PEN", "Philippines": "PHP", "Poland": "PLN", "Portugal": "EUR", 
//       "Qatar": "QAR", "Romania": "RON", "Russia": "RUB", "Rwanda": "RWF", "Saint Kitts and Nevis": "SKN", 
//       "Saint Lucia": "SLL", "Saint Vincent and the Grenadines": "SVG", "Samoa": "WST", "San Marino": "EUR", 
//       "Sao Tome and Principe": "STN", "Saudi Arabia": "SAR", "Senegal": "CFA", "Serbia": "RSD", 
//       "Seychelles": "SCR", "Sierra Leone": "SLL", "Singapore": "SGD", "Slovakia": "SKK", "Slovenia": "SIT", 
//       "Solomon Islands": "SBD", "Somalia": "SOS", "South Africa": "ZAR", "South Sudan": "SSP", "Spain": "EUR", 
//       "Sri Lanka": "LKR", "Sudan": "SDG", "Suriname": "SRD", "Sweden": "SEK", "Switzerland": "CHF", 
//       "Syria": "SYP", "Taiwan": "TWD", "Tajikistan": "TJS", "Tanzania": "TZS", "Thailand": "THB", 
//       "Togo": "CFA", "Tonga": "TOP", "Trinidad and Tobago": "TTD", "Tunisia": "TND", "Turkey": "TRY", 
//       "Turkmenistan": "TMT", "Tuvalu": "AUD", "Uganda": "UGX", "Ukraine": "UAH", "United Arab Emirates": "AED", 
//       "United Kingdom": "GBP", "United States": "USD", "Uruguay": "UYU", "Uzbekistan": "UZS", 
//       "Vanuatu": "VUV", "Vatican City": "EUR", "Venezuela": "VES", "Vietnam": "VND", "Yemen": "YER", 
//       "Zambia": "ZMK", "Zimbabwe": "ZWD"
//     };
  
//     return countryCurrencyMap[country] || 'USD'; // Default to USD if country not found
//   };
  
//   const getCurrencyList = () => {
//     return [
//       "AFN", "ALL", "ARS", "AUD", "AZN", "BBD", "BDT", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BWP", 
//       "BYN", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", 
//       "EGP", "ERN", "ETB", "EUR", "FJD", "GBP", "GEL", "GHS", "GMD", "GNF", "GQL", "GRD", "GTQ", "GYD", 
//       "HUF", "HWD", "IDR", "ILS", "INR", "IQD", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KPW", 
//       "KRW", "KWD", "KZT", "LAK", "LBP", "LKR", "LSL", "LTL", "MAD", "MGA", "MMK", "MNT", "MOP", "MUR", 
//       "MVR", "MXN", "MYR", "NAD", "NIO", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", 
//       "QAR", "RON", "RUB", "RWF", "SAR", "SBD", "SCR", "SEK", "SHP", "SIT", "SLL", "SLS", "SOS", "THB", 
//       "TRY", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VND", "VUV", "XCD", "ZAR", "ZMK", "ZWD"
//     ];
//   };
  

//   // Currency selection handler
//   const handleCurrencySelect = (currency: string) => {
//     setCurrency(currency);
//     setIsCurrencyModalVisible(false); // Close the currency selection modal
//   };

//   // Fallback for fetching user country (IP-based or other methods)
//   const getUserCountry = async () => {
//     try {
//       const response = await fetch('https://api.ipapi.com/api/check?access_key=YOUR_ACCESS_KEY'); // Replace with your API key
//       const data = await response.json();
//       return data.country_name; // The country of the user
//     } catch (error) {
//       console.error('Error fetching user country:', error);
//       return 'USA'; // Default to 'USA' in case of error
//     }
//   };

//   return (
//     <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
//       <View style={styles.container}>
//         <View style={styles.header}>
//           <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
//             <X size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Text style={styles.title}>Add Product</Text>
//           <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
//             <Text style={styles.saveButtonText}>Save</Text>
//           </TouchableOpacity>
//         </View>

//         <View style={styles.content}>
//           {/* Error Display */}
//           {errors.length > 0 && (
//             <View style={styles.errorContainer}>
//               {errors.map((error, index) => (
//                 <Text key={index} style={styles.errorText}>• {error}</Text>
//               ))}
//             </View>
//           )}

//           {/* Product Input Form */}
//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Name *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="Enter product name"
//               value={name}
//               onChangeText={setName}
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Price ({userCurrency}) *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0.00"
//               value={price}
//               onChangeText={setPrice}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Available Quantity *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0"
//               value={quantity}
//               onChangeText={setQuantity}
//               keyboardType="numeric"
//             />
//           </View>

//           {/* Currency Selection */}
//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Currency *</Text>
//             <TouchableOpacity onPress={() => setIsCurrencyModalVisible(true)}>
//               <Text style={styles.textInput}>{currency || userCurrency}</Text>
//             </TouchableOpacity>
//           </View>

//           {/* Currency Selection Modal */}
//           <Modal
//             visible={isCurrencyModalVisible}
//             animationType="slide"
//             onRequestClose={() => setIsCurrencyModalVisible(false)}
//           >
//             <View style={styles.currencyModal}>
//               <FlatList
//                 data={currencies}
//                 keyExtractor={(item) => item}
//                 renderItem={({ item }) => (
//                   <TouchableOpacity
//                     style={styles.currencyItem}
//                     onPress={() => handleCurrencySelect(item)}
//                   >
//                     <Text style={styles.currencyText}>{item}</Text>
//                   </TouchableOpacity>
//                 )}
//               />
//             </View>
//           </Modal>

//           {/* Image Picker */}
//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Image</Text>
//             {imageUri ? (
//               <View style={styles.imagePreviewContainer}>
//                 <Image source={{ uri: imageUri }} style={styles.imagePreview} />
//                 <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
//                   <X size={16} color="#fff" />
//                 </TouchableOpacity>
//               </View>
//             ) : (
//               <TouchableOpacity style={styles.imagePickerButton} onPress={handleImagePicker}>
//                 <ImageIcon size={24} color={Colors.dark.primary} />
//                 <Text style={styles.imagePickerText}>Add Product Image</Text>
//               </TouchableOpacity>
//             )}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     paddingVertical: 16,
//     backgroundColor: Colors.dark.card,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: '600',
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     padding: 8,
//   },
//   saveButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 8,
//   },
//   saveButtonText: {
//     fontSize: 16,
//     color: '#fff',
//     fontWeight: '600',
//   },
//   content: {
//     flex: 1,
//     padding: 20,
//   },
//   errorContainer: {
//     backgroundColor: 'rgba(244, 67, 54, 0.1)',
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 16,
//     borderLeftWidth: 4,
//     borderLeftColor: '#f44336',
//   },
//   errorText: {
//     color: '#f44336',
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   imagePickerButton: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 20,
//     alignItems: 'center',
//     justifyContent: 'center',
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//     borderStyle: 'dashed',
//   },
//   imagePickerText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     marginTop: 8,
//     fontWeight: '500',
//   },
//   imagePreviewContainer: {
//     position: 'relative',
//     alignSelf: 'center',
//   },
//   imagePreview: {
//     width: 120,
//     height: 120,
//     borderRadius: 8,
//   },
//   removeImageButton: {
//     position: 'absolute',
//     top: -8,
//     right: -8,
//     backgroundColor: '#ff3b30',
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   currencyModal: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     padding: 20,
//   },
//   currencyItem: {
//     paddingVertical: 15,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   currencyText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//   },
// });














// import React, { useState, useEffect } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   Modal,
//   StyleSheet,
//   Alert,
//   Platform,
// } from 'react-native';
// import { X, Camera, Image as ImageIcon } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import * as ImagePicker from 'expo-image-picker';
// import Colors from '@/constants/colors';

// // Assuming we have a function to fetch the logged-in user info
// import { getCurrentUser, getUserCountry } from '@/services/authService'; 

// interface Product {
//   name: string;
//   price: number;
//   available_quantity: number;
//   image?: string;
//   currency: string;
// }

// interface ProductCreationModalProps {
//   visible: boolean;
//   onClose: () => void;
//   onSave: (product: Product) => void;
//   eventOwnerId: string; // The event owner ID to verify if the current user is the event owner
// }

// export function ProductCreationModal({ visible, onClose, onSave, eventOwnerId }: ProductCreationModalProps) {
//   const [name, setName] = useState('');
//   const [price, setPrice] = useState('');
//   const [quantity, setQuantity] = useState('');
//   const [imageUri, setImageUri] = useState<string | null>(null);
//   const [errors, setErrors] = useState<string[]>([]);
//   const [currency, setCurrency] = useState('');
//   const [userCountry, setUserCountry] = useState('');
//   const [userCurrency, setUserCurrency] = useState('');

//   const [currencies, setCurrencies] = useState<string[]>([]); // List of currencies for the user to choose from

//   const handleSave = () => {
//     const validationErrors: string[] = [];

//     if (!name.trim()) {
//       validationErrors.push('Product name is required');
//     }
//     if (!price || parseFloat(price) <= 0) {
//       validationErrors.push('Valid price is required');
//     }
//     if (!quantity || parseInt(quantity) < 0) {
//       validationErrors.push('Valid quantity is required');
//     }
//     if (!currency) {
//       validationErrors.push('Currency is required');
//     }

//     if (validationErrors.length > 0) {
//       setErrors(validationErrors);
//       return;
//     }

//     const product: Product = {
//       name: name.trim(),
//       price: parseFloat(price),
//       available_quantity: parseInt(quantity),
//       image: imageUri || undefined,
//       currency,
//     };

//     onSave(product);
//     resetForm();
//   };

//   const resetForm = () => {
//     setName('');
//     setPrice('');
//     setQuantity('');
//     setImageUri(null);
//     setCurrency('');
//     setErrors([]);
//   };

//   const handleClose = () => {
//     resetForm();
//     onClose();
//   };

//   const handleImagePicker = () => {
//     Alert.alert(
//       'Select Image',
//       'Choose how you want to add a product image',
//       [
//         { text: 'Camera', onPress: openCamera },
//         { text: 'Gallery', onPress: openGallery },
//         { text: 'Cancel', style: 'cancel' }
//       ]
//     );
//   };

//   const openCamera = async () => {
//     const { status } = await ImagePicker.requestCameraPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Camera permission is required to take photos');
//       return;
//     }

//     const result = await ImagePicker.launchCameraAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const openGallery = async () => {
//     const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Gallery permission is required to select images');
//       return;
//     }

//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const removeImage = () => {
//     setImageUri(null);
//   };

//   // Fetch the logged-in user's country and currency
//   useEffect(() => {
//     const fetchUserData = async () => {
//       const user = await getCurrentUser();
//       if (user) {
//         // If the user is the event owner, fetch country/currency
//         if (user.id === eventOwnerId) {
//           const country = await getUserCountry(user.id);
//           setUserCountry(country);
//           // Fetch currency based on the country (you can use an API for this or a fixed list of countries and their currencies)
//           const countryCurrency = getCurrencyByCountry(country);
//           setUserCurrency(countryCurrency);
//           setCurrencies(getCurrencyList()); // Get a list of all currencies for selection
//         }
//       }
//     };
//     fetchUserData();
//   }, [eventOwnerId]);
  // const getCurrencyByCountry = (country: string) => {
  //   const countryCurrencyMap: { [key: string]: string } = {
  //     "Afghanistan": "AFN", "Albania": "ALL", "Algeria": "DZD", "Andorra": "EUR", "Angola": "AOA", 
  //     "Antigua and Barbuda": "XCD", "Argentina": "ARS", "Armenia": "AMD", "Australia": "AUD", "Austria": "EUR",
  //     "Azerbaijan": "AZN", "Bahamas": "BSD", "Bahrain": "BHD", "Bangladesh": "BDT", "Barbados": "BBD", 
  //     "Belarus": "BYN", "Belgium": "EUR", "Belize": "BZD", "Benin": "CFA", "Bhutan": "BTN", "Bolivia": "BOB", 
  //     "Bosnia and Herzegovina": "BAM", "Botswana": "BWP", "Brazil": "BRL", "Brunei": "BND", "Bulgaria": "BGN", 
  //     "Burkina Faso": "BF", "Burundi": "BIF", "Cabo Verde": "CVE", "Cambodia": "KHR", "Cameroon": "CDF", 
  //     "Canada": "CAD", "Central African Republic": "CDF", "Chad": "CDF", "Chile": "CLP", "China": "CNY", 
  //     "Colombia": "COP", "Comoros": "COM", "Congo, Democratic Republic of the": "CDF", "Congo, Republic of the": "CDF", 
  //     "Costa Rica": "CRC", "Croatia": "HRK", "Cuba": "CUP", "Cyprus": "CYP", "Czech Republic": "CZK", 
  //     "Denmark": "DKK", "Djibouti": "DJF", "Dominica": "XCD", "Dominican Republic": "DOP", "Ecuador": "USD", 
  //     "Egypt": "EGP", "El Salvador": "SVC", "Equatorial Guinea": "GNF", "Eritrea": "ERN", "Estonia": "EEK", 
  //     "Eswatini": "SZL", "Ethiopia": "ETB", "Fiji": "FJD", "Finland": "EUR", "France": "EUR", "Gabon": "GAB", 
  //     "Gambia": "GMD", "Georgia": "GEL", "Germany": "EUR", "Ghana": "GHS", "Greece": "EUR", "Grenada": "GRD", 
  //     "Guatemala": "GTQ", "Guinea": "GNF", "Guinea-Bissau": "GNF", "Guyana": "GYD", "Haiti": "HTG", 
  //     "Honduras": "HNL", "Hungary": "HUF", "Iceland": "ISK", "India": "INR", "Indonesia": "IDR", 
  //     "Iran": "IRR", "Iraq": "IQD", "Ireland": "EUR", "Israel": "ILS", "Italy": "EUR", "Jamaica": "JMD",
  //     "Japan": "JPY", "Jordan": "JOD", "Kazakhstan": "KZT", "Kenya": "KES", "Kiribati": "AUD", "Korea, North": "KPW", 
  //     "Korea, South": "KRW", "Kuwait": "KWD", "Kyrgyzstan": "KGS", "Laos": "LAK", "Latvia": "LVL", 
  //     "Lebanon": "LBP", "Lesotho": "LSL", "Liberia": "LRD", "Libya": "LYD", "Liechtenstein": "CHF", 
  //     "Lithuania": "EUR", "Luxembourg": "EUR", "Madagascar": "MGA", "Malawi": "MWK", "Malaysia": "MYR", 
  //     "Maldives": "MVR", "Mali": "CFA", "Malta": "EUR", "Marshall Islands": "USD", "Mauritania": "MRO", 
  //     "Mauritius": "MUR", "Mexico": "MXN", "Micronesia": "USD", "Moldova": "MDL", "Monaco": "EUR", 
  //     "Mongolia": "MNT", "Montenegro": "EUR", "Morocco": "MAD", "Mozambique": "MZN", "Myanmar": "MMK",
  //     "Namibia": "NAD", "Nauru": "AUD", "Nepal": "NPR", "Netherlands": "EUR", "New Zealand": "NZD", 
  //     "Nicaragua": "NIO", "Niger": "CFA", "Nigeria": "NGN", "North Macedonia": "MKD", "Norway": "NOK", 
  //     "Oman": "OMR", "Pakistan": "PKR", "Palau": "USD", "Panama": "PAB", "Papua New Guinea": "PGK", 
  //     "Paraguay": "PYG", "Peru": "PEN", "Philippines": "PHP", "Poland": "PLN", "Portugal": "EUR", 
  //     "Qatar": "QAR", "Romania": "RON", "Russia": "RUB", "Rwanda": "RWF", "Saint Kitts and Nevis": "SKN", 
  //     "Saint Lucia": "SLL", "Saint Vincent and the Grenadines": "SVG", "Samoa": "WST", "San Marino": "EUR", 
  //     "Sao Tome and Principe": "STN", "Saudi Arabia": "SAR", "Senegal": "CFA", "Serbia": "RSD", 
  //     "Seychelles": "SCR", "Sierra Leone": "SLL", "Singapore": "SGD", "Slovakia": "SKK", "Slovenia": "SIT", 
  //     "Solomon Islands": "SBD", "Somalia": "SOS", "South Africa": "ZAR", "South Sudan": "SSP", "Spain": "EUR", 
  //     "Sri Lanka": "LKR", "Sudan": "SDG", "Suriname": "SRD", "Sweden": "SEK", "Switzerland": "CHF", 
  //     "Syria": "SYP", "Taiwan": "TWD", "Tajikistan": "TJS", "Tanzania": "TZS", "Thailand": "THB", 
  //     "Togo": "CFA", "Tonga": "TOP", "Trinidad and Tobago": "TTD", "Tunisia": "TND", "Turkey": "TRY", 
  //     "Turkmenistan": "TMT", "Tuvalu": "AUD", "Uganda": "UGX", "Ukraine": "UAH", "United Arab Emirates": "AED", 
  //     "United Kingdom": "GBP", "United States": "USD", "Uruguay": "UYU", "Uzbekistan": "UZS", 
  //     "Vanuatu": "VUV", "Vatican City": "EUR", "Venezuela": "VES", "Vietnam": "VND", "Yemen": "YER", 
  //     "Zambia": "ZMK", "Zimbabwe": "ZWD"
  //   };
  
  //   return countryCurrencyMap[country] || 'USD'; // Default to USD if country not found
  // };
  
  // const getCurrencyList = () => {
  //   return [
  //     "AFN", "ALL", "ARS", "AUD", "AZN", "BBD", "BDT", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BWP", 
  //     "BYN", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", 
  //     "EGP", "ERN", "ETB", "EUR", "FJD", "GBP", "GEL", "GHS", "GMD", "GNF", "GQL", "GRD", "GTQ", "GYD", 
  //     "HUF", "HWD", "IDR", "ILS", "INR", "IQD", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KPW", 
  //     "KRW", "KWD", "KZT", "LAK", "LBP", "LKR", "LSL", "LTL", "MAD", "MGA", "MMK", "MNT", "MOP", "MUR", 
  //     "MVR", "MXN", "MYR", "NAD", "NIO", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", 
  //     "QAR", "RON", "RUB", "RWF", "SAR", "SBD", "SCR", "SEK", "SHP", "SIT", "SLL", "SLS", "SOS", "THB", 
  //     "TRY", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VND", "VUV", "XCD", "ZAR", "ZMK", "ZWD"
  //   ];
  // };
  
//   return (
//     <Modal
//       visible={visible}
//       animationType="slide"
//       presentationStyle="pageSheet"
//       onRequestClose={handleClose}
//     >
//       <View style={styles.container}>
//         <View style={styles.header}>
//           <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
//             <X size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Text style={styles.title}>Add Product</Text>
//           <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
//             <Text style={styles.saveButtonText}>Save</Text>
//           </TouchableOpacity>
//         </View>

//         <View style={styles.content}>
//           {/* Error Display */}
//           {errors.length > 0 && (
//             <View style={styles.errorContainer}>
//               {errors.map((error, index) => (
//                 <Text key={index} style={styles.errorText}>• {error}</Text>
//               ))}
//             </View>
//           )}

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Name *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="Enter product name"
//               placeholderTextColor={Colors.dark.subtext}
//               value={name}
//               onChangeText={setName}
//               maxLength={100}
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Price ({userCurrency}) *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0.00"
//               placeholderTextColor={Colors.dark.subtext}
//               value={price}
//               onChangeText={setPrice}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Available Quantity *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0"
//               placeholderTextColor={Colors.dark.subtext}
//               value={quantity}
//               onChangeText={setQuantity}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Currency *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="Select Currency"
//               placeholderTextColor={Colors.dark.subtext}
//               value={currency}
//               onChangeText={setCurrency}
//               editable
//             />
//             {/* Ideally, you would replace this with a dropdown list */}
//             <TouchableOpacity onPress={() => Alert.alert('Currency Selection', 'Select from available currencies')}>
//               <Text style={styles.textInput}>{userCurrency}</Text>
//             </TouchableOpacity>
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Image</Text>
//             {imageUri ? (
//               <View style={styles.imagePreviewContainer}>
//                 <Image source={{ uri: imageUri }} style={styles.imagePreview} />
//                 <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
//                   <X size={16} color="#fff" />
//                 </TouchableOpacity>
//               </View>
//             ) : (
//               <TouchableOpacity style={styles.imagePickerButton} onPress={handleImagePicker}>
//                 <ImageIcon size={24} color={Colors.dark.primary} />
//                 <Text style={styles.imagePickerText}>Add Product Image</Text>
//               </TouchableOpacity>
//             )}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     paddingVertical: 16,
//     backgroundColor: Colors.dark.card,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: '600',
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     padding: 8,
//   },
//   saveButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 8,
//   },
//   saveButtonText: {
//     fontSize: 16,
//     color: '#fff',
//     fontWeight: '600',
//   },
//   content: {
//     flex: 1,
//     padding: 20,
//   },
//   errorContainer: {
//     backgroundColor: 'rgba(244, 67, 54, 0.1)',
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 16,
//     borderLeftWidth: 4,
//     borderLeftColor: '#f44336',
//   },
//   errorText: {
//     color: '#f44336',
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   imagePickerButton: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 20,
//     alignItems: 'center',
//     justifyContent: 'center',
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//     borderStyle: 'dashed',
//   },
//   imagePickerText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     marginTop: 8,
//     fontWeight: '500',
//   },
//   imagePreviewContainer: {
//     position: 'relative',
//     alignSelf: 'center',
//   },
//   imagePreview: {
//     width: 120,
//     height: 120,
//     borderRadius: 8,
//   },
//   removeImageButton: {
//     position: 'absolute',
//     top: -8,
//     right: -8,
//     backgroundColor: '#ff3b30',
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
// });













// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   Modal,
//   StyleSheet,
//   Alert,
//   Platform,
// } from 'react-native';
// import { X, Camera, Image as ImageIcon } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import * as ImagePicker from 'expo-image-picker';
// import Colors from '@/constants/colors';

// interface Product {
//   name: string;
//   price: number;
//   available_quantity: number;
//   image?: string;
// }

// interface ProductCreationModalProps {
//   visible: boolean;
//   onClose: () => void;
//   onSave: (product: Product) => void;
// }

// export function ProductCreationModal({ visible, onClose, onSave }: ProductCreationModalProps) {
//   const [name, setName] = useState('');
//   const [price, setPrice] = useState('');
//   const [quantity, setQuantity] = useState('');
//   const [imageUri, setImageUri] = useState<string | null>(null);
//   const [errors, setErrors] = useState<string[]>([]);

//   const handleSave = () => {
//     const validationErrors: string[] = [];

//     if (!name.trim()) {
//       validationErrors.push('Product name is required');
//     }
//     if (!price || parseFloat(price) <= 0) {
//       validationErrors.push('Valid price is required');
//     }
//     if (!quantity || parseInt(quantity) < 0) {
//       validationErrors.push('Valid quantity is required');
//     }

//     if (validationErrors.length > 0) {
//       setErrors(validationErrors);
//       return;
//     }

//     const product: Product = {
//       name: name.trim(),
//       price: parseFloat(price),
//       available_quantity: parseInt(quantity),
//       image: imageUri || undefined,
//     };

//     onSave(product);
//     resetForm();
//   };

//   const resetForm = () => {
//     setName('');
//     setPrice('');
//     setQuantity('');
//     setImageUri(null);
//     setErrors([]);
//   };

//   const handleClose = () => {
//     resetForm();
//     onClose();
//   };

//   const handleImagePicker = () => {
//     Alert.alert(
//       'Select Image',
//       'Choose how you want to add a product image',
//       [
//         { text: 'Camera', onPress: openCamera },
//         { text: 'Gallery', onPress: openGallery },
//         { text: 'Cancel', style: 'cancel' }
//       ]
//     );
//   };

//   const openCamera = async () => {
//     const { status } = await ImagePicker.requestCameraPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Camera permission is required to take photos');
//       return;
//     }

//     const result = await ImagePicker.launchCameraAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const openGallery = async () => {
//     const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
//     if (status !== 'granted') {
//       Alert.alert('Permission Required', 'Gallery permission is required to select images');
//       return;
//     }

//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       aspect: [1, 1],
//       quality: 0.8,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setImageUri(result.assets[0].uri);
//     }
//   };

//   const removeImage = () => {
//     setImageUri(null);
//   };

//   return (
//     <Modal
//       visible={visible}
//       animationType="slide"
//       presentationStyle="pageSheet"
//       onRequestClose={handleClose}
//     >
//       <View style={styles.container}>
//         <View style={styles.header}>
//           <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
//             <X size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Text style={styles.title}>Add Product</Text>
//           <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
//             <Text style={styles.saveButtonText}>Save</Text>
//           </TouchableOpacity>
//         </View>

//         <View style={styles.content}>
//           {/* Error Display */}
//           {errors.length > 0 && (
//             <View style={styles.errorContainer}>
//               {errors.map((error, index) => (
//                 <Text key={index} style={styles.errorText}>• {error}</Text>
//               ))}
//             </View>
//           )}

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Name *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="Enter product name"
//               placeholderTextColor={Colors.dark.subtext}
//               value={name}
//               onChangeText={setName}
//               maxLength={100}
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Price ($) *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0.00"
//               placeholderTextColor={Colors.dark.subtext}
//               value={price}
//               onChangeText={setPrice}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Available Quantity *</Text>
//             <TextInput
//               style={styles.textInput}
//               placeholder="0"
//               placeholderTextColor={Colors.dark.subtext}
//               value={quantity}
//               onChangeText={setQuantity}
//               keyboardType="numeric"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Product Image</Text>
//             {imageUri ? (
//               <View style={styles.imagePreviewContainer}>
//                 <Image source={{ uri: imageUri }} style={styles.imagePreview} />
//                 <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
//                   <X size={16} color="#fff" />
//                 </TouchableOpacity>
//               </View>
//             ) : (
//               <TouchableOpacity style={styles.imagePickerButton} onPress={handleImagePicker}>
//                 <ImageIcon size={24} color={Colors.dark.primary} />
//                 <Text style={styles.imagePickerText}>Add Product Image</Text>
//               </TouchableOpacity>
//             )}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     paddingVertical: 16,
//     backgroundColor: Colors.dark.card,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: '600',
//     color: Colors.dark.text,
//   },
//   closeButton: {
//     padding: 8,
//   },
//   saveButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 8,
//   },
//   saveButtonText: {
//     fontSize: 16,
//     color: '#fff',
//     fontWeight: '600',
//   },
//   content: {
//     flex: 1,
//     padding: 20,
//   },
//   errorContainer: {
//     backgroundColor: 'rgba(244, 67, 54, 0.1)',
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 16,
//     borderLeftWidth: 4,
//     borderLeftColor: '#f44336',
//   },
//   errorText: {
//     color: '#f44336',
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   imagePickerButton: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 20,
//     alignItems: 'center',
//     justifyContent: 'center',
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//     borderStyle: 'dashed',
//   },
//   imagePickerText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     marginTop: 8,
//     fontWeight: '500',
//   },
//   imagePreviewContainer: {
//     position: 'relative',
//     alignSelf: 'center',
//   },
//   imagePreview: {
//     width: 120,
//     height: 120,
//     borderRadius: 8,
//   },
//   removeImageButton: {
//     position: 'absolute',
//     top: -8,
//     right: -8,
//     backgroundColor: '#ff3b30',
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
// });