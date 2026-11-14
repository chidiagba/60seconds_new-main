import { logger } from '@/lib/logger';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { EventCreationService, EventCreationData } from '../lib/event-creation-service';
import { ProductCreationModal } from './ProductCreationModal';
import { supabase } from '@/lib/supabase';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';

interface EventCreationFormProps {
  onEventCreated?: (result: any) => void;
  onCancel?: () => void;
  initialVideoData?: {
    title: string;
    description?: string;
    video_url: string;
    thumbnail_url?: string;
    duration?: number;
    file_size?: number;
  };
}

interface Product {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  type: 'ticket' | 'drink' | 'reservation' | 'merchandise';
  available_quantity?: number;
  image_url?: string;
}

export function EventCreationForm({ 
  onEventCreated, 
  onCancel, 
  initialVideoData 
}: EventCreationFormProps) {
  // Event form state
  const [eventName, setEventName] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('100');
  const [ticketPrice, setTicketPrice] = useState('0');
  const [category, setCategory] = useState('General');
  const [hashtags, setHashtags] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [status, setStatus] = useState<'draft' | 'published'>('published');

  // Video form state
  const [videoTitle, setVideoTitle] = useState(initialVideoData?.title || '');
  const [videoDescription, setVideoDescription] = useState(initialVideoData?.description || '');

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const loadDefaultCurrency = async () => {
      const { data } = await supabase.auth.getUser();
      const authUser = data?.user;
      if (!authUser) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('country, country_code')
        .eq('id', authUser.id)
        .maybeSingle();

      const currency = resolveCurrencyFromCountry({
        country: profile?.country || authUser.user_metadata?.country,
        countryCode: profile?.country_code || authUser.user_metadata?.country_code,
      });

      setDefaultCurrency(currency);
    };

    loadDefaultCurrency();
  }, []);

  const handleCreateEvent = async () => {
    try {
      setIsLoading(true);
      setErrors([]);

      // Prepare event data
      const eventData: EventCreationData = {
        event: {
          event_name: eventName.trim(),
          description: eventDescription.trim() || undefined,
          start_date: startDate,
          end_date: endDate || undefined,
          location_name: locationName.trim() || undefined,
          location_city: locationCity.trim() || undefined,
          max_attendees: parseInt(maxAttendees) || 100,
          ticket_price: parseFloat(ticketPrice) || 0,
          currency: defaultCurrency,
          category: category.trim() || 'General',
          hashtags: hashtags.split(',').map(tag => tag.trim()).filter(tag => tag),
          is_public: isPublic,
          status: status
        }
      };

      // Add video data if provided
      if (initialVideoData || videoTitle) {
        eventData.video = {
          title: videoTitle.trim(),
          description: videoDescription.trim() || undefined,
          video_url: initialVideoData?.video_url || '',
          thumbnail_url: initialVideoData?.thumbnail_url,
          duration: initialVideoData?.duration,
          file_size: initialVideoData?.file_size,
          location_city: locationCity.trim() || undefined,
          hashtags: hashtags.split(',').map(tag => tag.trim()).filter(tag => tag)
        };
      }

      // Add products if any
      if (products.length > 0) {
        eventData.products = products;
      }

      // Validate data
      const validation = EventCreationService.validateEventData(eventData);
      if (!validation.valid) {
        setErrors(validation.errors);
        return;
      }

      // Create event
      const result = await EventCreationService.createEventWithRelations(eventData);

      if (result.success) {
        Alert.alert(
          'Success!',
          `Event "${eventName}" has been created successfully!${
            result.details?.productCount > 0 
              ? `\n\nAdded ${result.details.productCount} products.`
              : ''
          }`,
          [
            {
              text: 'OK',
              onPress: () => onEventCreated?.(result)
            }
          ]
        );
      } else {
        setErrors([result.error || 'Failed to create event']);
      }
    } catch (error) {
      logger.error('Event creation error:', error);
      setErrors(['An unexpected error occurred. Please try again.']);
    } finally {
      setIsLoading(false);
    }
  };

  const addProduct = (product: Product) => {
    setProducts(prev => [...prev, { ...product, currency: product.currency || defaultCurrency }]);
    setShowProductModal(false);
  };

  const removeProduct = (index: number) => {
    setProducts(prev => prev.filter((_, i) => i !== index));
  };

  const formatDate = (date: Date) => {
    return date.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM format
  };

  const getDefaultStartDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  };

  const getDefaultEndDate = () => {
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    return formatDate(dayAfter);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Create New Event</Text>

      {errors.length > 0 && (
        <View style={styles.errorContainer}>
          {errors.map((error, index) => (
            <Text key={index} style={styles.errorText}>• {error}</Text>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Event Details</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Event Name *"
          value={eventName}
          onChangeText={setEventName}
          maxLength={100}
        />

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Description"
          value={eventDescription}
          onChangeText={setEventDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
        />

        <View style={styles.row}>
          <View style={styles.halfWidth}>
            <TextInput
              style={styles.input}
              placeholder="Start Date *"
              value={startDate || getDefaultStartDate()}
              onChangeText={setStartDate}
            />
          </View>
          <View style={styles.halfWidth}>
            <TextInput
              style={styles.input}
              placeholder="End Date"
              value={endDate || getDefaultEndDate()}
              onChangeText={setEndDate}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.halfWidth}>
            <TextInput
              style={styles.input}
              placeholder="Location Name"
              value={locationName}
              onChangeText={setLocationName}
            />
          </View>
          <View style={styles.halfWidth}>
            <TextInput
              style={styles.input}
              placeholder="City"
              value={locationCity}
              onChangeText={setLocationCity}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.halfWidth}>
            <TextInput
              style={styles.input}
              placeholder="Max Attendees"
              value={maxAttendees}
              onChangeText={setMaxAttendees}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.halfWidth}>
            <TextInput
              style={styles.input}
              placeholder="Ticket Price ($)"
              value={ticketPrice}
              onChangeText={setTicketPrice}
              keyboardType="numeric"
            />
          </View>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Category"
          value={category}
          onChangeText={setCategory}
        />

        <TextInput
          style={styles.input}
          placeholder="Hashtags (comma separated)"
          value={hashtags}
          onChangeText={setHashtags}
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Public Event</Text>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={isPublic ? '#f5dd4b' : '#f4f3f4'}
          />
        </View>
      </View>

      {initialVideoData && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Video Details</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Video Title *"
            value={videoTitle}
            onChangeText={setVideoTitle}
            maxLength={100}
          />

          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Video Description"
            value={videoDescription}
            onChangeText={setVideoDescription}
            multiline
            numberOfLines={2}
            maxLength={300}
          />
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Products & Services</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowProductModal(true)}
          >
            <Text style={styles.addButtonText}>+ Add Product</Text>
          </TouchableOpacity>
        </View>

        {products.length > 0 && (
          <View style={styles.productsList}>
            {products.map((product, index) => (
              <View key={index} style={styles.productItem}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productPrice}>{`${product.currency || defaultCurrency} ${product.price}`}</Text>
                  <Text style={styles.productType}>{product.type}</Text>
                </View>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeProduct(index)}
                >
                  <Text style={styles.removeButtonText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={onCancel}
          disabled={isLoading}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.createButton]}
          onPress={handleCreateEvent}
          disabled={isLoading || !eventName.trim()}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createButtonText}>
              {status === 'draft' ? 'Save Draft' : 'Create Event'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ProductCreationModal
        visible={showProductModal}
        onClose={() => setShowProductModal(false)}
        onSave={addProduct}
        defaultCurrency={defaultCurrency}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#f44336',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    marginBottom: 4,
  },
  section: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfWidth: {
    width: '48%',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  switchLabel: {
    fontSize: 16,
    color: '#333',
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  productsList: {
    marginTop: 8,
  },
  productItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  productPrice: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  productType: {
    fontSize: 12,
    color: '#666',
    textTransform: 'capitalize',
  },
  removeButton: {
    backgroundColor: '#ff3b30',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 40,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  createButton: {
    backgroundColor: '#007AFF',
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});














/////////////////////////////////////    13    jan      2026    /////////////////////


// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   ScrollView,
//   Alert,
//   StyleSheet,
//   ActivityIndicator,
//   Switch,
// } from 'react-native';
// import { EventCreationService, EventCreationData } from '../lib/event-creation-service';
// import { ProductCreationModal } from './ProductCreationModal';

// interface EventCreationFormProps {
//   onEventCreated?: (result: any) => void;
//   onCancel?: () => void;
//   initialVideoData?: {
//     title: string;
//     description?: string;
//     video_url: string;
//     thumbnail_url?: string;
//     duration?: number;
//     file_size?: number;
//   };
// }

// interface Product {
//   name: string;
//   description?: string;
//   price: number;
//   currency?: string;
//   type: 'ticket' | 'drink' | 'reservation' | 'merchandise';
//   available_quantity?: number;
//   image_url?: string;
// }

// export function EventCreationForm({ 
//   onEventCreated, 
//   onCancel, 
//   initialVideoData 
// }: EventCreationFormProps) {
//   // Event form state
//   const [eventName, setEventName] = useState('');
//   const [eventDescription, setEventDescription] = useState('');
//   const [startDate, setStartDate] = useState('');
//   const [endDate, setEndDate] = useState('');
//   const [locationName, setLocationName] = useState('');
//   const [locationCity, setLocationCity] = useState('');
//   const [maxAttendees, setMaxAttendees] = useState('100');
//   const [ticketPrice, setTicketPrice] = useState('0');
//   const [category, setCategory] = useState('General');
//   const [hashtags, setHashtags] = useState('');
//   const [isPublic, setIsPublic] = useState(true);
//   const [status, setStatus] = useState<'draft' | 'published'>('published');

//   // Video form state
//   const [videoTitle, setVideoTitle] = useState(initialVideoData?.title || '');
//   const [videoDescription, setVideoDescription] = useState(initialVideoData?.description || '');

//   // Products state
//   const [products, setProducts] = useState<Product[]>([]);
//   const [showProductModal, setShowProductModal] = useState(false);

//   // UI state
//   const [isLoading, setIsLoading] = useState(false);
//   const [errors, setErrors] = useState<string[]>([]);

//   const handleCreateEvent = async () => {
//     try {
//       setIsLoading(true);
//       setErrors([]);

//       // Prepare event data
//       const eventData: EventCreationData = {
//         event: {
//           event_name: eventName.trim(),
//           description: eventDescription.trim() || undefined,
//           start_date: startDate,
//           end_date: endDate || undefined,
//           location_name: locationName.trim() || undefined,
//           location_city: locationCity.trim() || undefined,
//           max_attendees: parseInt(maxAttendees) || 100,
//           ticket_price: parseFloat(ticketPrice) || 0,
//           currency: 'USD',
//           category: category.trim() || 'General',
//           hashtags: hashtags.split(',').map(tag => tag.trim()).filter(tag => tag),
//           is_public: isPublic,
//           status: status
//         }
//       };

//       // Add video data if provided
//       if (initialVideoData || videoTitle) {
//         eventData.video = {
//           title: videoTitle.trim(),
//           description: videoDescription.trim() || undefined,
//           video_url: initialVideoData?.video_url || '',
//           thumbnail_url: initialVideoData?.thumbnail_url,
//           duration: initialVideoData?.duration,
//           file_size: initialVideoData?.file_size,
//           location_city: locationCity.trim() || undefined,
//           hashtags: hashtags.split(',').map(tag => tag.trim()).filter(tag => tag)
//         };
//       }

//       // Add products if any
//       if (products.length > 0) {
//         eventData.products = products;
//       }

//       // Validate data
//       const validation = EventCreationService.validateEventData(eventData);
//       if (!validation.valid) {
//         setErrors(validation.errors);
//         return;
//       }

//       // Create event
//       const result = await EventCreationService.createEventWithRelations(eventData);

//       if (result.success) {
//         Alert.alert(
//           'Success!',
//           `Event "${eventName}" has been created successfully!${
//             result.details?.productCount > 0 
//               ? `\n\nAdded ${result.details.productCount} products.`
//               : ''
//           }`,
//           [
//             {
//               text: 'OK',
//               onPress: () => onEventCreated?.(result)
//             }
//           ]
//         );
//       } else {
//         setErrors([result.error || 'Failed to create event']);
//       }
//     } catch (error) {
//       logger.error('Event creation error:', error);
//       setErrors(['An unexpected error occurred. Please try again.']);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   const addProduct = (product: Product) => {
//     setProducts(prev => [...prev, product]);
//     setShowProductModal(false);
//   };

//   const removeProduct = (index: number) => {
//     setProducts(prev => prev.filter((_, i) => i !== index));
//   };

//   const formatDate = (date: Date) => {
//     return date.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM format
//   };

//   const getDefaultStartDate = () => {
//     const tomorrow = new Date();
//     tomorrow.setDate(tomorrow.getDate() + 1);
//     return formatDate(tomorrow);
//   };

//   const getDefaultEndDate = () => {
//     const dayAfter = new Date();
//     dayAfter.setDate(dayAfter.getDate() + 2);
//     return formatDate(dayAfter);
//   };

//   return (
//     <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
//       <Text style={styles.title}>Create New Event</Text>

//       {/* Error Display */}
//       {errors.length > 0 && (
//         <View style={styles.errorContainer}>
//           {errors.map((error, index) => (
//             <Text key={index} style={styles.errorText}>• {error}</Text>
//           ))}
//         </View>
//       )}

//       {/* Event Details Section */}
//       <View style={styles.section}>
//         <Text style={styles.sectionTitle}>Event Details</Text>
        
//         <TextInput
//           style={styles.input}
//           placeholder="Event Name *"
//           value={eventName}
//           onChangeText={setEventName}
//           maxLength={100}
//         />

//         <TextInput
//           style={[styles.input, styles.textArea]}
//           placeholder="Description"
//           value={eventDescription}
//           onChangeText={setEventDescription}
//           multiline
//           numberOfLines={3}
//           maxLength={500}
//         />

//         <View style={styles.row}>
//           <View style={styles.halfWidth}>
//             <TextInput
//               style={styles.input}
//               placeholder="Start Date *"
//               value={startDate || getDefaultStartDate()}
//               onChangeText={setStartDate}
//             />
//           </View>
//           <View style={styles.halfWidth}>
//             <TextInput
//               style={styles.input}
//               placeholder="End Date"
//               value={endDate || getDefaultEndDate()}
//               onChangeText={setEndDate}
//             />
//           </View>
//         </View>

//         <View style={styles.row}>
//           <View style={styles.halfWidth}>
//             <TextInput
//               style={styles.input}
//               placeholder="Location Name"
//               value={locationName}
//               onChangeText={setLocationName}
//             />
//           </View>
//           <View style={styles.halfWidth}>
//             <TextInput
//               style={styles.input}
//               placeholder="City"
//               value={locationCity}
//               onChangeText={setLocationCity}
//             />
//           </View>
//         </View>

//         <View style={styles.row}>
//           <View style={styles.halfWidth}>
//             <TextInput
//               style={styles.input}
//               placeholder="Max Attendees"
//               value={maxAttendees}
//               onChangeText={setMaxAttendees}
//               keyboardType="numeric"
//             />
//           </View>
//           <View style={styles.halfWidth}>
//             <TextInput
//               style={styles.input}
//               placeholder="Ticket Price ($)"
//               value={ticketPrice}
//               onChangeText={setTicketPrice}
//               keyboardType="numeric"
//             />
//           </View>
//         </View>

//         <TextInput
//           style={styles.input}
//           placeholder="Category"
//           value={category}
//           onChangeText={setCategory}
//         />

//         <TextInput
//           style={styles.input}
//           placeholder="Hashtags (comma separated)"
//           value={hashtags}
//           onChangeText={setHashtags}
//         />

//         <View style={styles.switchRow}>
//           <Text style={styles.switchLabel}>Public Event</Text>
//           <Switch
//             value={isPublic}
//             onValueChange={setIsPublic}
//             trackColor={{ false: '#767577', true: '#81b0ff' }}
//             thumbColor={isPublic ? '#f5dd4b' : '#f4f3f4'}
//           />
//         </View>
//       </View>

//       {/* Video Section */}
//       {initialVideoData && (
//         <View style={styles.section}>
//           <Text style={styles.sectionTitle}>Video Details</Text>
          
//           <TextInput
//             style={styles.input}
//             placeholder="Video Title *"
//             value={videoTitle}
//             onChangeText={setVideoTitle}
//             maxLength={100}
//           />

//           <TextInput
//             style={[styles.input, styles.textArea]}
//             placeholder="Video Description"
//             value={videoDescription}
//             onChangeText={setVideoDescription}
//             multiline
//             numberOfLines={2}
//             maxLength={300}
//           />
//         </View>
//       )}

//       {/* Products Section */}
//       <View style={styles.section}>
//         <View style={styles.sectionHeader}>
//           <Text style={styles.sectionTitle}>Products & Services</Text>
//           <TouchableOpacity
//             style={styles.addButton}
//             onPress={() => setShowProductModal(true)}
//           >
//             <Text style={styles.addButtonText}>+ Add Product</Text>
//           </TouchableOpacity>
//         </View>

//         {products.length > 0 && (
//           <View style={styles.productsList}>
//             {products.map((product, index) => (
//               <View key={index} style={styles.productItem}>
//                 <View style={styles.productInfo}>
//                   <Text style={styles.productName}>{product.name}</Text>
//                   <Text style={styles.productPrice}>${product.price}</Text>
//                   <Text style={styles.productType}>{product.type}</Text>
//                 </View>
//                 <TouchableOpacity
//                   style={styles.removeButton}
//                   onPress={() => removeProduct(index)}
//                 >
//                   <Text style={styles.removeButtonText}>×</Text>
//                 </TouchableOpacity>
//               </View>
//             ))}
//           </View>
//         )}
//       </View>

//       {/* Action Buttons */}
//       <View style={styles.buttonContainer}>
//         <TouchableOpacity
//           style={[styles.button, styles.cancelButton]}
//           onPress={onCancel}
//           disabled={isLoading}
//         >
//           <Text style={styles.cancelButtonText}>Cancel</Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[styles.button, styles.createButton]}
//           onPress={handleCreateEvent}
//           disabled={isLoading || !eventName.trim()}
//         >
//           {isLoading ? (
//             <ActivityIndicator color="#fff" />
//           ) : (
//             <Text style={styles.createButtonText}>
//               {status === 'draft' ? 'Save Draft' : 'Create Event'}
//             </Text>
//           )}
//         </TouchableOpacity>
//       </View>

//       {/* Product Creation Modal */}
//       <ProductCreationModal
//         visible={showProductModal}
//         onClose={() => setShowProductModal(false)}
//         onSave={addProduct}
//       />
//     </ScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     padding: 20,
//     backgroundColor: '#f5f5f5',
//   },
//   title: {
//     fontSize: 24,
//     fontWeight: 'bold',
//     marginBottom: 20,
//     textAlign: 'center',
//     color: '#333',
//   },
//   errorContainer: {
//     backgroundColor: '#ffebee',
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 16,
//     borderLeftWidth: 4,
//     borderLeftColor: '#f44336',
//   },
//   errorText: {
//     color: '#c62828',
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   section: {
//     backgroundColor: '#fff',
//     padding: 16,
//     borderRadius: 12,
//     marginBottom: 16,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//     elevation: 3,
//   },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     marginBottom: 12,
//   },
//   sectionTitle: {
//     fontSize: 18,
//     fontWeight: '600',
//     color: '#333',
//     marginBottom: 12,
//   },
//   input: {
//     borderWidth: 1,
//     borderColor: '#ddd',
//     borderRadius: 8,
//     padding: 12,
//     fontSize: 16,
//     marginBottom: 12,
//     backgroundColor: '#fff',
//   },
//   textArea: {
//     height: 80,
//     textAlignVertical: 'top',
//   },
//   row: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//   },
//   halfWidth: {
//     width: '48%',
//   },
//   switchRow: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     marginTop: 8,
//   },
//   switchLabel: {
//     fontSize: 16,
//     color: '#333',
//   },
//   addButton: {
//     backgroundColor: '#007AFF',
//     paddingHorizontal: 12,
//     paddingVertical: 6,
//     borderRadius: 6,
//   },
//   addButtonText: {
//     color: '#fff',
//     fontSize: 14,
//     fontWeight: '500',
//   },
//   productsList: {
//     marginTop: 8,
//   },
//   productItem: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     backgroundColor: '#f8f9fa',
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 8,
//   },
//   productInfo: {
//     flex: 1,
//   },
//   productName: {
//     fontSize: 16,
//     fontWeight: '500',
//     color: '#333',
//   },
//   productPrice: {
//     fontSize: 14,
//     color: '#007AFF',
//     fontWeight: '600',
//   },
//   productType: {
//     fontSize: 12,
//     color: '#666',
//     textTransform: 'capitalize',
//   },
//   removeButton: {
//     backgroundColor: '#ff3b30',
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   removeButtonText: {
//     color: '#fff',
//     fontSize: 16,
//     fontWeight: 'bold',
//   },
//   buttonContainer: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     marginTop: 20,
//     marginBottom: 40,
//   },
//   button: {
//     flex: 1,
//     paddingVertical: 14,
//     borderRadius: 8,
//     alignItems: 'center',
//     marginHorizontal: 8,
//   },
//   cancelButton: {
//     backgroundColor: '#f0f0f0',
//     borderWidth: 1,
//     borderColor: '#ddd',
//   },
//   cancelButtonText: {
//     color: '#666',
//     fontSize: 16,
//     fontWeight: '500',
//   },
//   createButton: {
//     backgroundColor: '#007AFF',
//   },
//   createButtonText: {
//     color: '#fff',
//     fontSize: 16,
//     fontWeight: '600',
//   },
// });

