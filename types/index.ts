// User types
export interface User {
  id: string;
  name: string;
  displayName?: string;
  username: string;
  email?: string;
  avatar: string;
  bio?: string;
  followers: number;
  following: number;
  isBusinessAccount: boolean;
  businessName?: string;
  businessType?: string;
  createdAt?: string;
}

// Video types
export interface Video {
  id: string;
  url: string;
  watermarkedVideoUrl?: string;
  watermarkStatus?: 'pending' | 'processing' | 'ready' | 'failed';
  thumbnail: string;
  description?: string;
  likes: number;
  comments: number;
  shares: number;
  rating: number;
  ratingCount: number;
  userId: string;
  user: User;
  createdAt: string;
  location: Location;
  eventName: string;
  eventDate?: string;
  products?: Product[];
  hashtags?: string[];
  caption?: string;
  shareAnalytics?: ShareAnalytics;
  eventId?: string; // Add event ID to link to products
  eventImageUrl?: string;
  eventStartDate?: string;
  eventEndDate?: string;
  eventStatus?: 'open' | 'closed';
  taggedUsers?: TaggedUser[]; // Added tagged users
  attendees?: Attendee[]; // Added attendees
  attendeeCount?: number; // Total number of attendees
  guestList?: GuestListEntry[]; // Guest list entries
  guestListRequests?: GuestListRequest[]; // Guest list requests
}

// Attendee type for event attendance
export interface Attendee {
  userId: string;
  user: User;
  status: AttendanceStatus;
  timestamp: string; // When they RSVP'd
  notes?: string; // Optional notes from the attendee
}

// Attendance status options
export enum AttendanceStatus {
  GOING = 'going',
  MAYBE = 'maybe',
  INTERESTED = 'interested',
  INVITED = 'invited',
  DECLINED = 'declined'
}

// Tagged user in a video
export interface TaggedUser {
  userId: string;
  user: User;
  timestamp?: number; // Optional timestamp in seconds for when the user appears in the video
  position?: { x: number; y: number }; // Optional position on screen
}

export interface ShareAnalytics {
  facebook?: number;
  twitter?: number;
  instagram?: number;
  whatsapp?: number;
  tiktok?: number;
  copy?: number;
  email?: number;
  sms?: number;
  messenger?: number;
  telegram?: number;
  snapchat?: number;
  pinterest?: number;
  linkedin?: number;
  reddit?: number;
  tumblr?: number;
  webpage?: number;
  other?: number;
  total: number;
}

export interface Location {
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
}

// Comment types
export interface Comment {
  id: string;
  videoId: string;
  userId: string;
  user: User;
  text: string;
  likes: number;
  createdAt: string;
  parentId?: string; // ID of the parent comment if this is a reply
  replies?: Comment[]; // Array of reply comments
}



export interface Product {
  id: string;
  videoId: string;
  name: string;
  description: string;
  price: number;
  image: string;
  type: ProductType;
  available: number;
  createdAt: string;
  sold?: number;
  ownerId?: string; // Added ownerId field
  stripeConnectedAccountId?: string; // Added stripeConnectedAccountId field
  eventOwnerId?: string; // Event Owner ID (added if it's coming from the event)
  creatorId?: string; // Creator ID (added if it's coming from the creator)
  ownerStripeAccountId?: string; // Stripe Account ID (added if it's part of the product's owner)
  currency?: string; // Added currency field
}



// export interface Product {
//   id: string;
//   videoId: string;
//   name: string;
//   description: string;
//   price: number;
//   image: string;
//   type: ProductType;
//   available: number;
//   createdAt: string;
//   sold?: number;
//   ownerId?: string; // Added ownerId field
//   stripeConnectedAccountId?: string; // Added stripeConnectedAccountId field
//   eventOwnerId?: string; // Event Owner ID (added if it's coming from the event)
//   creatorId?: string; // Creator ID (added if it's coming from the creator)
//   ownerStripeAccountId?: string; // Stripe Account ID (added if it's part of the product's owner)
//   currency?: string; // Added currency field
// }




export type ProductType = 'ticket' | 'drink' | 'reservation' | 'merchandise';

// Voucher types
export interface Voucher {
  currency?: string;
  eventId?: string;
  allowedUserIds?: string[];
  perUserLimit?: number;
  applicableProducts?: string[];
  applicableCategories?: string[];
  id: string;
  businessId: string;
  code: string;
  productId?: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  expiryDate: string;
  usageLimit: number;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
  description?: string;
  name: string;
}

// Rating types
export type RatingValue = 1 | 2 | 3 | 4 | 5;

// Share types
export type ShareSource = 
  | 'facebook' 
  | 'twitter' 
  | 'instagram' 
  | 'whatsapp' 
  | 'tiktok' 
  | 'copy' 
  | 'email' 
  | 'sms' 
  | 'messenger'
  | 'telegram'
  | 'snapchat'
  | 'pinterest'
  | 'linkedin'
  | 'reddit'
  | 'tumblr'
  | 'webpage'
  | 'other';

// Upload types
export interface UploadProgress {
  progress: number;
  status: 'idle' | 'uploading' | 'processing' | 'success' | 'error';
  error?: string;
}

// Search types
export interface SearchFilters {
  location?: string;
  hashtag?: string;
  eventName?: string;
  date?: string;
  price?: {
    min: number;
    max: number;
  };
}

// Chat types
export interface Chat {
  id: string;
  participants: string[]; // User IDs
  lastMessage?: Message;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  read: boolean;
  createdAt: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  thumbnailUrl?: string;
  name?: string;
  size?: number;
}

// Guest List types
export interface GuestListEntry {
  id: string;
  eventId: string;
  userId: string;
  user: User;
  status: GuestListStatus;
  addedBy: string; // User ID of who added them
  addedAt: string;
  notes?: string;
}

export interface GuestListRequest {
  id: string;
  eventId: string;
  userId: string;
  user: User;
  status: GuestListRequestStatus;
  message?: string;
  requestedAt: string;
  respondedAt?: string;
  respondedBy?: string;
}

export enum GuestListStatus {
  CONFIRMED = 'confirmed',
  PENDING = 'pending',
  DECLINED = 'declined',
  REMOVED = 'removed'
}

export enum GuestListRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

// Reservation types
export interface Reservation {
  id: string;
  userId: string;
  eventId?: string;
  videoId?: string;
  businessId?: string;
  reservationType: 'event' | 'table' | 'service' | 'appointment';
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  reservationDate: string;
  reservationTime?: string;
  partySize?: number;
  specialRequests?: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  totalAmount?: number;
  currency?: string;
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
  confirmationCode?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  user?: User;
  event?: Event;
  video?: Video;
}

export interface CreateReservationData {
  eventId?: string;
  videoId?: string;
  businessId?: string;
  reservationType: 'event' | 'table' | 'service' | 'appointment';
  reservationDate: string;
  reservationTime?: string;
  partySize?: number;
  specialRequests?: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  totalAmount?: number;
  currency?: string;
  metadata?: Record<string, any>;
}

export interface ReservationFilters {
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  reservationType?: 'event' | 'table' | 'service' | 'appointment';
  dateRange?: {
    start: string;
    end: string;
  };
  businessId?: string;
  eventId?: string;
  videoId?: string;
}

// Event types (extending existing)
export interface Event {
  id: string;
  userId: string;
  eventName: string;
  description?: string;
  startDate: string;
  endDate?: string;
  locationName?: string;
  locationAddress?: string;
  locationCity?: string;
  locationState?: string;
  locationCountry?: string;
  locationLatitude?: number;
  locationLongitude?: number;
  maxAttendees?: number;
  currentAttendees: number;
  ticketPrice?: number;
  currency?: string;
  imageUrl?: string;
  category?: string;
  tags?: string[];
  isPublic: boolean;
  requiresApproval: boolean;
  status: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
  createdAt: string;
  updatedAt: string;
  user?: User;
  reservations?: Reservation[];
}

// Business Customer Management types
export interface BusinessCustomer {
  id: string;
  businessId: string;
  customerId: string;
  customer: User;
  firstInteractionDate: string;
  lastInteractionDate: string;
  totalInteractions: number;
  totalSpent: number;
  interactionTypes: InteractionType[];
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoInteraction {
  id: string;
  userId: string;
  videoId: string;
  businessId: string;
  interactionType: InteractionType;
  interactionData?: any;
  createdAt: string;
  user?: User;
  video?: Video;
}

export type InteractionType = 'view' | 'like' | 'comment' | 'share' | 'purchase';

export interface VoucherShare {
  id: string;
  voucherId: string;
  businessId: string;
  customerId: string;
  sharedVia: 'message' | 'email' | 'notification';
  messageText?: string;
  isUsed: boolean;
  usedAt?: string;
  createdAt: string;
  voucher?: Voucher;
  customer?: User;
}

export interface CustomerFilters {
  interactionType?: InteractionType;
  dateRange?: {
    start: string;
    end: string;
  };
  minSpent?: number;
  maxSpent?: number;
  tags?: string[];
  search?: string;
}

export interface CustomerStats {
  totalCustomers: number;
  newCustomersThisMonth: number;
  totalRevenue: number;
  averageSpentPerCustomer: number;
  topInteractionType: InteractionType;
  repeatCustomerRate: number;
}

// Order PDF types
export interface OrderPDF {
  id: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  pdfUrl: string;
  qrCodeData: string;
  generatedAt: string;
  expiresAt?: string;
  isActive: boolean;
}

export interface OrderPDFData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  businessName: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  currency: string;
  orderDate: string;
  qrCodeData: string;
  notes?: string;
}

export interface OrderItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  type: ProductType;
}

// Authentication types
export interface AuthCredentials {
  username: string;
  password: string;
}

export interface RegistrationData {
  name: string;
  username: string;
  email: string;
  password: string;
  accountType: 'personal' | 'business';
  businessName?: string;
  businessType?: string;
}
