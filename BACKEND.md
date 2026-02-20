# InkBook — Firebase Backend Architecture

## 📁 Firestore Data Structure

### `artists/{uid}`
```json
{
  "uid": "firebase-auth-uid",
  "email": "kai@email.com",
  "displayName": "Kai Nguyen",
  "handle": "inkmaster_kai",  // Unique, used in booking URL
  "bio": "Fine line specialist",
  "location": "Los Angeles, CA",
  "specialties": ["Fine Line", "Botanical", "Geometric"],
  "plan": "free",  // free | pro | studio
  "bookingLink": "book.inkbook.io/inkmaster_kai",
  "avatar": "https://storage.firebase.../avatar.jpg",
  "stats": {
    "totalBookings": 2400,
    "rating": 4.9,
    "yearsExperience": 6
  },
  "availability": {
    "days": ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    "startTime": "10:00",
    "endTime": "18:00",
    "slotDuration": 60
  },
  "paypal": {
    "email": "kai@paypal.com",
    "connected": true
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `flash_designs/{designId}`
```json
{
  "artistId": "firebase-auth-uid",
  "name": "Rose Vine",
  "description": "Delicate botanical vine wrapping design",
  "price": 200,
  "size": "4-5 inches",
  "duration": "2hrs",
  "style": "Fine Line",
  "imageUrl": "https://storage.firebase.../rose_vine.jpg",
  "available": true,
  "bookingCount": 12,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `bookings/{bookingId}`
```json
{
  "artistId": "firebase-auth-uid",
  "artistHandle": "inkmaster_kai",
  "clientName": "Sarah Johnson",
  "clientEmail": "sarah@email.com",
  "clientPhone": "+1 (555) 000-0000",
  "clientAge": 25,
  "designId": "design-id",
  "designName": "Rose Vine",
  "designType": "flash",  // flash | custom
  "customDescription": "",
  "date": "timestamp",
  "timeSlot": "10:00 AM",
  "estimatedDuration": 120,
  "totalPrice": 200,
  "depositAmount": 100,
  "depositPaid": true,
  "paypalOrderId": "PAYPAL-ORDER-123",
  "paypalTransactionId": "PAYPAL-TX-456",
  "consentSigned": true,
  "consentTimestamp": "timestamp",
  "status": "confirmed",  // pending | confirmed | in_progress | completed | cancelled | no_show
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 🔒 Security Rules Summary

| Collection | Read | Create | Update | Delete |
|-----------|------|--------|--------|--------|
| `artists` | Public | Owner only | Owner only | ❌ |
| `flash_designs` | Public | Owner only | Owner only | Owner only |
| `bookings` | Artist only | Public (clients) | Artist only | ❌ |

## 💳 PayPal Flow

```
Client selects design → Picks date/time → Signs consent
    ↓
PayPal Smart Button rendered → Client pays deposit
    ↓
PayPal captures payment → Returns orderId + transactionId
    ↓
Firestore: booking.depositPaid = true, status = 'confirmed'
    ↓
Artist receives notification in dashboard
```

## 🔗 Firestore Indexes

Create these composite indexes in Firebase Console:

1. `bookings` — `artistId ASC`, `date DESC`
2. `bookings` — `artistId ASC`, `status ASC`, `date DESC`
3. `bookings` — `artistId ASC`, `date ASC` (for date range queries)
4. `flash_designs` — `artistId ASC`, `createdAt DESC`
5. `flash_designs` — `artistId ASC`, `available ASC`, `createdAt DESC`
6. `artists` — `handle ASC` (for public booking page lookup)

## 📦 Source Modules

| File | Purpose |
|------|---------|
| `src/firebase.js` | Firebase initialization & exports |
| `src/auth.js` | Registration, login, profile management |
| `src/bookings.js` | Booking CRUD, stats, real-time |
| `src/gallery.js` | Flash design CRUD, image upload |
| `src/paypal.js` | PayPal SDK, Smart Buttons, deposit flow |

## 🚀 Setup Steps

1. Create Firebase project at `console.firebase.google.com`
2. Enable **Authentication** (Email + Google)
3. Enable **Firestore** (Start in test mode, then deploy rules)
4. Enable **Storage** (For flash design images)
5. Copy Firebase config to `src/firebase.js`
6. Create PayPal app at `developer.paypal.com`
7. Copy Client ID to `src/paypal.js`
8. Deploy: `firebase deploy`
