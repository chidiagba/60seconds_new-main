import { Video, Product, TaggedUser, AttendanceStatus, Attendee } from '@/types';
import { mockProducts } from './products';
import { mockUsers } from './users';

// Create some mock attendees
const createMockAttendees = (videoId: string): Attendee[] => {
  // Use different users for each video
  const attendeeUsers = mockUsers.slice(0, 5);

  return attendeeUsers.map((user, index) => ({
    userId: user.id,
    user,
    status: index < 3 ? AttendanceStatus.GOING :
      index === 3 ? AttendanceStatus.MAYBE :
        AttendanceStatus.INTERESTED,
    timestamp: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(), // Random time in the last week
    notes: index === 0 ? "Can't wait for this event!" : undefined
  }));
};

export const mockVideos: Video[] = [
  {
    id: '1',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-dj-playing-music-in-a-disco-club-4430-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1571266028243-5c6c25a45a8e',
    userId: '1',
    user: {
      id: '1',
      username: 'clubvibes',
      name: 'Club Vibes',
      displayName: 'Club Vibes', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61',
      isBusinessAccount: true,
      followers: 12500,
      following: 235,
    },
    caption: "Tonight's energy is unmatched! 🔥 #NightlifeVibes",
    eventName: "Saturday Night Fever",
    eventDate: "2025-06-15T21:00:00Z",
    location: {
      name: "Pulse Nightclub",
      latitude: 40.7128,
      longitude: -74.0060,
      address: "123 Party Street",
      city: "New York",
      state: "NY",
      country: "USA"
    },
    likes: 3452,
    comments: 127,
    shares: 89,
    rating: 4.7,
    ratingCount: 230,
    createdAt: "2025-05-22T21:30:00Z",
    hashtags: ["NightlifeVibes", "SaturdayNight", "ClubLife", "DJSet"],
    products: [
      mockProducts[0],
      mockProducts[1]
    ],
    taggedUsers: [
      {
        userId: '2',
        user: mockUsers[1],
        timestamp: 3,
        position: { x: 0.3, y: 0.4 }
      },
      {
        userId: '4',
        user: mockUsers[3],
        timestamp: 8,
        position: { x: 0.7, y: 0.6 }
      }
    ],
    attendees: createMockAttendees('1'),
    attendeeCount: 3 // Number of people with 'going' status
  },
  {
    id: '2',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-young-woman-dancing-happily-in-a-field-4702-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7',
    userId: '2',
    user: {
      id: '2',
      username: 'musiclover',
      name: 'Music Lover',
      displayName: 'Music Lover', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
      isBusinessAccount: false,
      followers: 5230,
      following: 412,
    },
    caption: "Best outdoor festival this summer! 🎵 #SummerVibes",
    eventName: "Electric Summer Festival",
    eventDate: "2025-07-04T16:00:00Z",
    location: {
      name: "Central Park",
      latitude: 40.7829,
      longitude: -73.9654,
      address: "Central Park",
      city: "New York",
      state: "NY",
      country: "USA"
    },
    likes: 2198,
    comments: 87,
    shares: 45,
    rating: 4.5,
    ratingCount: 178,
    createdAt: "2025-05-21T18:45:00Z",
    hashtags: ["SummerVibes", "Festival", "OutdoorParty", "LiveMusic"],
    taggedUsers: [
      {
        userId: '3',
        user: mockUsers[2],
        timestamp: 5,
        position: { x: 0.5, y: 0.3 }
      }
    ],
    attendees: createMockAttendees('2'),
    attendeeCount: 3
  },
  {
    id: '3',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-dj-playing-music-in-a-nightclub-4344-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745',
    userId: '3',
    user: {
      id: '3',
      username: 'echonights',
      name: 'Echo Nights',
      displayName: 'Echo Nights', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d',
      isBusinessAccount: true,
      followers: 28700,
      following: 112,
    },
    caption: "DJ Max dropping the best beats in town 🎧 #TechnoNight",
    eventName: "Techno Thursdays",
    eventDate: "2025-06-06T22:00:00Z",
    location: {
      name: "Echo Club",
      latitude: 34.0522,
      longitude: -118.2437,
      address: "456 Beat Street",
      city: "Los Angeles",
      state: "CA",
      country: "USA"
    },
    likes: 5621,
    comments: 231,
    shares: 178,
    rating: 4.9,
    ratingCount: 342,
    createdAt: "2025-05-20T22:15:00Z",
    hashtags: ["TechnoNight", "DJMax", "UndergroundScene", "LosAngeles"],
    products: [
      mockProducts[2],
      mockProducts[3]
    ],
    taggedUsers: [
      {
        userId: '5',
        user: mockUsers[4],
        timestamp: 2,
        position: { x: 0.2, y: 0.5 }
      },
      {
        userId: '6',
        user: mockUsers[5],
        timestamp: 12,
        position: { x: 0.8, y: 0.4 }
      }
    ],
    attendees: createMockAttendees('3'),
    attendeeCount: 3
  },
  {
    id: '4',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-group-of-friends-partying-happily-4640-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec',
    userId: '4',
    user: {
      id: '4',
      username: 'partyseeker',
      name: 'Party Seeker',
      displayName: 'Party Seeker', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80',
      isBusinessAccount: false,
      followers: 3450,
      following: 567,
    },
    caption: "Squad night out! This place is lit 🔥 #SquadGoals",
    eventName: "Friday Night Party",
    eventDate: "2025-06-13T23:00:00Z",
    location: {
      name: "Skybar Lounge",
      latitude: 51.5074,
      longitude: -0.1278,
      address: "789 High Street",
      city: "London",
      state: "",
      country: "UK"
    },
    likes: 1876,
    comments: 98,
    shares: 34,
    rating: 4.3,
    ratingCount: 156,
    createdAt: "2025-05-19T23:10:00Z",
    hashtags: ["SquadGoals", "FridayNight", "Skybar", "London"],
    taggedUsers: [
      {
        userId: '1',
        user: mockUsers[0],
        timestamp: 4,
        position: { x: 0.4, y: 0.7 }
      },
      {
        userId: '2',
        user: mockUsers[1],
        timestamp: 7,
        position: { x: 0.6, y: 0.3 }
      },
      {
        userId: '3',
        user: mockUsers[2],
        timestamp: 15,
        position: { x: 0.3, y: 0.6 }
      }
    ],
    attendees: createMockAttendees('4'),
    attendeeCount: 3
  },
  {
    id: '5',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-concert-of-an-electronic-music-band-4710-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14',
    userId: '5',
    user: {
      id: '5',
      username: 'liveconcerts',
      name: 'Live Concerts',
      displayName: 'Live Concerts', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e',
      isBusinessAccount: true,
      followers: 42100,
      following: 89,
    },
    caption: "Incredible performance by Neon Dreams! 🎸 #LiveMusic",
    eventName: "Neon Dreams Tour",
    eventDate: "2025-06-20T20:00:00Z",
    location: {
      name: "Metro Concert Hall",
      latitude: 41.8781,
      longitude: -87.6298,
      address: "101 Concert Avenue",
      city: "Chicago",
      state: "IL",
      country: "USA"
    },
    likes: 8932,
    comments: 412,
    shares: 267,
    rating: 4.8,
    ratingCount: 523,
    createdAt: "2025-05-18T20:30:00Z",
    hashtags: ["LiveMusic", "NeonDreams", "ConcertLife", "TourStop", "Chicago"],
    products: [
      mockProducts[4]
    ],
    attendees: createMockAttendees('5'),
    attendeeCount: 3
  },
  {
    id: '6',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-dj-playing-music-at-a-concert-4364-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819',
    userId: '6',
    user: {
      id: '6',
      username: 'rooftopvibes',
      name: 'Rooftop Vibes',
      displayName: 'Rooftop Vibes', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6',
      isBusinessAccount: true,
      followers: 18700,
      following: 145,
    },
    caption: "Sunset sessions with the best view in town 🌇 #RooftopBar",
    eventName: "Sunset Sessions",
    eventDate: "2025-06-08T19:00:00Z",
    location: {
      name: "Sky Lounge Rooftop",
      latitude: 34.0736,
      longitude: -118.4004,
      address: "555 Skyline Drive",
      city: "Los Angeles",
      state: "CA",
      country: "USA"
    },
    likes: 4532,
    comments: 187,
    shares: 112,
    rating: 4.6,
    ratingCount: 278,
    createdAt: "2025-05-17T19:45:00Z",
    hashtags: ["RooftopBar", "SunsetSessions", "Cocktails", "CityViews", "LosAngeles"],
    attendees: createMockAttendees('6'),
    attendeeCount: 3
  },
  {
    id: '7',
    url: 'https://assets.mixkit.co/videos/preview/mixkit-people-dancing-at-a-concert-4189-large.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1506157786151-b8491531f063',
    userId: '7',
    user: {
      id: '7',
      username: 'jazzlovers',
      name: 'Jazz Lovers',
      displayName: 'Jazz Lovers', // Added displayName to match name
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
      isBusinessAccount: true,
      followers: 9200,
      following: 312,
    },
    caption: "Smooth jazz night with incredible talents 🎷 #JazzClub",
    eventName: "Jazz & Blues Night",
    eventDate: "2025-06-10T21:00:00Z",
    location: {
      name: "Blue Note Jazz Club",
      latitude: 40.7303,
      longitude: -74.0007,
      address: "131 W 3rd St",
      city: "New York",
      state: "NY",
      country: "USA"
    },
    likes: 2876,
    comments: 143,
    shares: 89,
    rating: 4.7,
    ratingCount: 198,
    createdAt: "2025-05-16T21:30:00Z",
    hashtags: ["JazzClub", "LiveJazz", "BluesMusic", "NightOut", "NewYork"],
    attendees: createMockAttendees('7'),
    attendeeCount: 3
  }
];