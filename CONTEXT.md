# Commerce

## Language

**Product**:
A platform-catalogue definition that gives a stable SKU its commercial and
fulfillment meaning. Product management and persistence belong to the Rare API.

**SKU**:
An immutable, versioned platform-catalogue identifier shared by a seller
Listing and a platform Order Line.
_Avoid_: Mutable product identifier

**Listing**:
A seller-authorized set of terms for fulfilling a SKU. Listings are committed
by a signed Listing Root and may be reused until filled, expired, or invalidated.
_Avoid_: Order

**Listing Root**:
A seller-signed Merkle commitment to one or more Listings, governed by a seller
nonce and deadline.

**Purchase Order**:
A platform-authorized, immutable fixed quote containing ordered settlement and
fulfillment obligations. Changing an item, fee, route, recipient, amount, or
deadline creates a new Purchase Order with a new order ID.
_Avoid_: Mutable cart

**Order Line**:
One exact signed settlement obligation in a Purchase Order. Merchandise,
shipping, royalties, service charges, and other platform-authorized amounts are
peer Order Lines.

**Payer**:
The transaction sender whose assets fund the Purchase Order. The Payer may be a
collector or a third-party processor and is independent from fulfillment
recipients.

**Cart Intent**:
An editable selection of Listings, quantities, recipients, and payment
currency that a buyer asks the platform to price. It is not authorized or
executable.

**Checkout Preparation**:
A non-durable, unsigned presentation of the items, fees, settlement
obligations, payment amount, currency conversion, and validity period for a
Cart Intent. It requires no Payer or wallet.

**Checkout**:
The client workflow that prepares commercial terms and purchases them by
obtaining, submitting, and verifying a signed Purchase Order. Checkout is not
a distinct on-chain domain object.

**Protocol Spread**:
Favorable execution variance retained by the protocol under a fixed quote,
including unused exact-output input or excess exact-input output.
