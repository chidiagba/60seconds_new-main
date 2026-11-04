// Route params for the table screens. Merge these into your app's
// React Navigation param list (see README).
export type TablesStackParamList = {
  // Business
  ManageTables: { venueId: string };
  TableEditor: { venueId: string; tableId?: string };
  VenueReservations: { venueId: string };
  // Guest
  VenueTables: { venueId: string; venueName?: string };
  BookTable: { tableId: string; startsAt?: string };
  MyReservations: undefined;
};
