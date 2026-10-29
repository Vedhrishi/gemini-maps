/**
 * "Nearest beach / Chinese restaurant / Japanese temple / Dominos…": find any kind of place.
 *
 * The spoken phrase is split into a kind of place (beach, restaurant, temple…) and qualifiers
 * (chinese, japanese, vegetarian, diesel, a brand name…). Places are looked up in the offline
 * India place cells first (instant), then OpenStreetMap through Overpass with a search radius
 * that grows until something turns up. Results come back in honest tiers:
 *   exact    – the kind and every qualifier match
 *   related  – the kind matches and the qualifier is a close relative (a Buddhist temple for "Japanese")
 *   category – only the kind matches (the qualifier was not found at all)
 */
import { rowsNear, inIndia } from './hyd'
import { norm } from './gazetteer'
import type { Place } from './routing'

export interface NearCat {
  id: string; label: string; icon: string; say: string
  /** words people say for it */
  words: RegExp
  /** offline data: the place kind (Overture category) */
  match: RegExp
  /** offline data: names that also count when the kind is vague (a "religious organization" called ... Temple) */
  nameMatch?: RegExp
  /** OpenStreetMap filters, each the inside of a [...] selector */
  osm: string[]
  /** first search radius and the furthest worth trying, in km */
  start: number; max: number
  /** offline kinds that are not really this (an amusement park is not a park) */
  deny?: RegExp
  /** names that are not really this (a film studio listed as a cinema) */
  nameDeny?: RegExp
  group?: 'food' | 'worship'
  /** shown as a quick chip in the Nearby row */
  chip?: boolean
  /** goes in the "Small shops" row rather than "Nearby" */
  shop?: boolean
}

const cat = (id: string, label: string, icon: string, say: string, words: RegExp, match: RegExp, osm: string[],
  start = 3, max = 60, extra: Partial<NearCat> = {}): NearCat => ({ id, label, icon, say, words, match, osm, start, max, ...extra })

const WORSHIP_VAGUE = /religious|historic|monument|landmark|tourist|attraction|charity|trust|organization|association|community|non governmental|social/

/** Specific kinds first: the first category whose words appear wins. */
export const NEAR_CATS: NearCat[] = [
  cat('ev', 'EV charging', '🔌', 'charging station', /charging|\bev\b|electric (car|vehicle|bike)/, /charging station|ev charg/, ['"amenity"="charging_station"'], 4, 80, { chip: true }),
  cat('fuel', 'Petrol', '⛽', 'petrol pump', /petrol|gas station|fuel|diesel|filling station|\bpumps?\b|\bcng\b|bunk/, /gas station|fuel|petrol|filling|\bcng\b/, ['"amenity"="fuel"'], 3, 80, { chip: true }),
  cat('carwash', 'Car wash', '🚿', 'car wash', /car ?wash|bike ?wash|water ?service|car detailing|vehicle wash|car spa|washing (centre|center)/, /car wash|auto detailing/, ['"amenity"="car_wash"'], 4, 40, { chip: true }),
  cat('mechanic', 'Mechanic', '🔧', 'car mechanic', /mechanic|garage|puncture|tyre|tire|repair shop|service cent(er|re)|workshop|bike repair/, /automotive repair|auto repair|car repair|tire|tyre|mechanic|garage|motorcycle repair|automotive service/, ['"shop"~"car_repair|tyres|motorcycle_repair"', '"amenity"="car_repair"'], 3, 40, { chip: true }),
  cat('showroom', 'Showroom', '🚗', 'car showroom', /showroom|car dealer|bike dealer|car dealership|bike showroom/, /auto dealer|car dealer|motorcycle dealer|bike store|motorsport vehicle dealer|auto company|used auto dealer/, ['"shop"~"car|motorcycle"'], 5, 60),
  cat('hospital', 'Hospital', '🏥', 'hospital', /hospital|emergency room|trauma|casualty|nursing home/, /hospital|emergency room|trauma|medical center/, ['"amenity"="hospital"'], 4, 80, { chip: true }),
  cat('dentist', 'Dentist', '🦷', 'dentist', /dentist|dental/, /dental|dentist|dentistry/, ['"amenity"="dentist"'], 3, 40),
  cat('vet', 'Vet', '🐾', 'veterinarian', /\bvet\b|veterinar|pet clinic|animal hospital/, /veterinar|pet clinic|animal hospital/, ['"amenity"="veterinary"'], 5, 60),
  cat('clinic', 'Clinic', '🩺', 'clinic', /doctor|clinic|physician|dispensary|health cent(er|re)/, /doctors office|clinic|general practi|health care|medical center|outpatient|family medicine/, ['"amenity"~"clinic|doctors"', '"healthcare"="clinic"'], 3, 40),
  cat('pharmacy', 'Pharmacy', '💊', 'pharmacy', /pharmacy|medical (store|shop)|medicine|chemist|drugstore/, /pharmacy|drugstore|chemist|medical supply/, ['"amenity"="pharmacy"', '"shop"="chemist"'], 2, 40, { chip: true }),
  cat('bloodbank', 'Blood bank', '🩸', 'blood bank', /blood (bank|donation)/, /blood and plasma|blood bank/, ['"healthcare"="blood_donation"'], 8, 100),
  cat('police', 'Police', '🚓', 'police station', /police/, /police/, ['"amenity"="police"'], 5, 100, { chip: true }),
  cat('fire', 'Fire station', '🚒', 'fire station', /fire (station|brigade)/, /fire station|fire department/, ['"amenity"="fire_station"'], 8, 100),
  cat('atm', 'ATM', '🏧', 'ATM', /\batms?\b|cash machine|withdraw cash|need cash/, /\batm\b/, ['"amenity"="atm"'], 2, 30, { chip: true }),
  cat('bank', 'Bank', '🏦', 'bank', /\bbanks?\b|credit union/, /bank|credit union/, ['"amenity"="bank"'], 3, 40),
  cat('parking', 'Parking', '🅿️', 'parking', /parking|park my (car|bike)/, /parking/, ['"amenity"="parking"'], 2, 20, { chip: true }),
  cat('toilet', 'Restroom', '🚻', 'public restroom', /toilet|restroom|washroom|loo\b|bathroom/, /public toilet|restroom|washroom/, ['"amenity"="toilets"'], 3, 30),

  // eating and drinking
  cat('icecream', 'Ice cream', '🍦', 'ice cream shop', /ice ?cream|gelato|kulfi|frozen dessert/, /ice cream|dessert|frozen yogurt/, ['"amenity"="ice_cream"', '"shop"="ice_cream"'], 3, 30),
  cat('bakery', 'Bakery & sweets', '🥐', 'bakery', /bakery|bakeries|cake|sweets?\b|patisserie|mithai|confectioner/, /bakery|patisserie|cake|dessert|sweet|candy|confection|chocolatier/, ['"shop"~"bakery|pastry|confectionery"'], 3, 30, { chip: true, shop: true }),
  cat('cafe', 'Cafe', '☕', 'cafe', /\bcafes?\b|coffee|tea (shop|stall|house)|chai/, /\bcafe\b|coffee|tea room|tea house|tea shop|chai/, ['"amenity"="cafe"'], 2, 30, { chip: true }),
  cat('bar', 'Bar & pub', '🍺', 'bar', /\bbars?\b|\bpubs?\b|brewery|nightclub|night club|\bclub\b|lounge|cocktail|beer/, /\bbar\b|\bpub\b|brew|night ?club|dance club|lounge|cocktail/, ['"amenity"~"bar|pub|biergarten|nightclub"'], 3, 40),
  cat('liquor', 'Wine shop', '🍷', 'wine shop', /liquor|wine ?shop|wines\b|alcohol|beer shop/, /liquor|wine|beer/, ['"shop"~"alcohol|wine"'], 3, 30),
  cat('food', 'Restaurant', '🍽', 'restaurant', /restaurants?|\bfood\b|\beat\b|eatery|eateries|hungry|dhaba|lunch|dinner|breakfast|meals?\b|tiffin|dining|canteen|food court|fast food|takeaway/,
    /restaurant|dhaba|food court|diner|eatery|biryani|barbecue|bar and grill|food truck|food stand|fast food|canteen|tiffin|sandwich|burger|pizza|steak|seafood/, ['"amenity"~"restaurant|fast_food|food_court"'], 2, 40, { group: 'food', chip: true }),

  // places of worship
  cat('mosque', 'Mosque', '🕌', 'mosque', /mosques?|masjid|dargah|idgah|namaz/, /muslim place of worship|mosque|masjid|dargah/, ['"amenity"="place_of_worship"]["religion"="muslim"'], 3, 60, { nameMatch: /masjid|mosque|dargah|jamia|idgah/, group: 'worship' }),
  cat('church', 'Church', '⛪', 'church', /churches|church|chapel|cathedral/, /christian|catholic|baptist|pentecostal|church|methodist|lutheran|anglican|protestant/, ['"amenity"="place_of_worship"]["religion"="christian"'], 3, 60, { nameMatch: /church|chapel|cathedral/, group: 'worship' }),
  cat('gurdwara', 'Gurdwara', '🛐', 'gurdwara', /gurdwara|gurudwara|sikh/, /sikh/, ['"amenity"="place_of_worship"]["religion"="sikh"'], 6, 150, { nameMatch: /gurdwara|gurudwara/, group: 'worship' }),
  cat('temple', 'Temple', '🛕', 'temple', /temples?|mandir|mandiram|devalayam|devasthanam|gudi|kovil|shrine|pagoda|monastery|vihara|stupa|place of worship|worship|pray|puja/,
    /(hindu|buddhist|jain|sikh|shinto|taoist) place of worship|temple|monastery|shrine|buddhist|jain/, ['"amenity"="place_of_worship"]["religion"~"hindu|buddhist|jain|shinto|taoist|sikh"', '"building"="temple"'], 3, 80,
    { nameMatch: /temple|mandir|devasth|devalay|gudi\b|kovil|alayam|stupa|monastery|pagoda|shrine/, group: 'worship', chip: true }),

  // out and about
  cat('beach', 'Beach', '🏖', 'beach', /beach(es)?|beech|seaside|sea ?shore|coast|sea face/, /beach/, ['"natural"="beach"', '"leisure"="beach_resort"'], 15, 700, { nameMatch: /beach/ }),
  cat('waterfall', 'Waterfall', '💦', 'waterfall', /waterfalls?|falls\b/, /waterfall/, ['"waterway"="waterfall"'], 25, 400, { nameMatch: /falls?\b|waterfall/ }),
  cat('lake', 'Lake', '🌊', 'lake', /\blakes?\b|pond|reservoir|\bdam\b|tank bund/, /\blake\b|reservoir|dam\b/, ['"natural"="water"]["water"~"lake|reservoir"', '"waterway"="dam"'], 8, 200, { nameMatch: /lake|sagar|cheruvu|talab|reservoir|\bdam\b/ }),
  cat('hill', 'Viewpoint', '⛰', 'viewpoint', /\bhills?\b|mountain|viewpoint|view point|\bpeak\b|trek|hiking|sunset point|sunrise point/, /mountain|viewpoint|peak|hill|trail/, ['"tourism"="viewpoint"', '"natural"="peak"'], 10, 250, { nameMatch: /view ?point|\bhill\b|gutta|peak|point\b/ }),
  cat('park', 'Park', '🌳', 'park', /\bparks?\b|gardens?|playground|botanical|walking track|jogging/, /\bpark\b|garden|playground|botanical|nature preserve/, ['"leisure"~"park|garden|playground|nature_reserve"'], 2, 40, { nameMatch: /\bpark\b|garden|udyan|bagh\b/, deny: /amusement|theme park|water park|trailer|parking|skate|industrial|business park|software|techno|it park/, nameDeny: /apartment|towers?|business|techno|software|it park|industrial|villas?|colony|residen/, chip: true }),
  cat('zoo', 'Zoo', '🦁', 'zoo', /\bzoos?\b|safari|aquarium|wildlife|sanctuary|national park/, /\bzoo\b|aquarium|wildlife|safari|animal park/, ['"tourism"~"zoo|aquarium"', '"boundary"="national_park"', '"leisure"="nature_reserve"'], 15, 400, { nameMatch: /\bzoo\b|safari|sanctuary|aquarium|national park/ }),
  cat('museum', 'Museum', '🏛', 'museum', /museums?|art gallery|\bgalleries\b|\bgallery\b/, /museum|art gallery/, ['"tourism"~"museum|gallery"'], 5, 100),
  cat('fort', 'Tourist spot', '🏰', 'tourist attraction', /\bfort\b|forts|palace|monument|tourist|sightseeing|attraction|heritage|historic|places to visit|things to do|landmark|tomb|ruins/,
    /historic|monument|tourist|fort|palace|landmark|attraction|archaeological/, ['"tourism"="attraction"', '"historic"~"fort|castle|monument|palace|ruins|archaeological_site|tomb"'], 6, 150, { nameMatch: /\bfort\b|palace|qila|mahal|tomb|monument|minar|gate\b/ }),
  cat('cinema', 'Cinema', '🎬', 'cinema', /cinemas?|movies?|theat(er|re)s?|multiplex|film|pvr|inox/, /movie theater|cinema|multiplex/, ['"amenity"="cinema"'], 4, 60, { nameMatch: /cinema|multiplex|\bpvr\b|inox|theat(er|re)/, nameDeny: /studio|outdoor unit|production|film (nagar|city)|post production|cine ?equipment/ }),
  cat('mall', 'Mall', '🛍', 'shopping mall', /\bmalls?\b|shopping (cent(er|re)|complex|mall)|shopping|hypermarket/, /shopping mall|shopping cent|department store|warehouse club|hypermarket/, ['"shop"="mall"', '"shop"="department_store"'], 5, 60, { nameMatch: /\bmall\b/ }),
  cat('stadium', 'Stadium', '🏟', 'stadium', /stadium|sports (complex|ground|arena)|cricket ground|football ground|play ?ground|swimming pool|badminton|tennis/, /stadium|sports|cricket|court|swimming|arena|athletic/, ['"leisure"~"stadium|sports_centre|pitch|swimming_pool"'], 4, 60),
  cat('gym', 'Gym', '🏋', 'gym', /\bgyms?\b|fitness|workout|yoga|crossfit/, /\bgym\b|fitness|yoga|sport or fitness/, ['"leisure"="fitness_centre"'], 3, 40),
  cat('hotel', 'Hotel', '🛏', 'hotel', /\bhotels?\b|resort|lodges?|lodging|\bstay\b|hostel|guest ?house|accommodation|motel|homestay|room to stay|\binn\b/, /\bhotel\b|resort|lodg|hostel|guest house|motel|\binn\b|bed and breakfast|holiday rental/, ['"tourism"~"hotel|guest_house|hostel|motel|resort"'], 3, 60, { chip: true }),
  cat('banquet', 'Function hall', '🎉', 'function hall', /banquet|function hall|convention|wedding hall|marriage hall|party hall|auditorium|kalyana ?mandapam/, /banquet|function|convention|wedding|event venue|auditorium|community center|party/, ['"amenity"~"events_venue|community_centre|conference_centre"', '"leisure"="banquet_hall"'], 4, 60, { nameMatch: /banquet|function hall|convention|kalyana|auditorium|mandapam/ }),

  // transport
  cat('airport', 'Airport', '✈️', 'airport', /airports?|flight|aerodrome|terminal/, /airport|airline|aerodrome|airfield/, ['"aeroway"~"aerodrome|terminal"', '"aeroway"="aerodrome"'], 30, 800, { nameMatch: /airport/ }),
  cat('train', 'Railway station', '🚉', 'railway station', /railway|train (station|stop)|\btrains?\b|junction|rly/, /train station|railway|rail station|metro station/, ['"railway"="station"', '"public_transport"="station"]["train"="yes"'], 6, 200, { nameMatch: /railway|junction|\bstation\b|rly/ }),
  cat('metro', 'Metro', '🚇', 'metro station', /metro|subway|underground/, /metro|subway|light rail/, ['"station"="subway"', '"railway"="subway_entrance"', '"station"="light_rail"'], 5, 100, { nameMatch: /metro/ }),
  cat('bus', 'Bus stop', '🚌', 'bus stop', /bus (stop|station|stand|depot)|\bbus\b|bus bay|\bbus$/, /bus station|bus stop|bus stand|transit/, ['"highway"="bus_stop"', '"amenity"="bus_station"'], 2, 30, { nameMatch: /bus (stop|stand|station|depot)/ }),

  // shopping and services
  cat('grocery', 'Groceries', '🛒', 'supermarket', /grocery|groceries|supermarket|kirana|provision|convenience|\bmart\b|vegetables?|fruits?|general store|daily needs/, /grocery|supermarket|convenience|kirana|produce|general store|wholesale grocer|food and beverage store/, ['"shop"~"supermarket|convenience|greengrocer|general"'], 2, 30, { chip: true, shop: true }),
  cat('mobile', 'Mobile & electronics', '📱', 'mobile shop', /mobile (shop|store)|phone (shop|store|repair)|electronics?|laptop|gadgets?|computer (shop|store)|mobile repair/, /mobile phone|electronics|computer store|appliance|phone repair|camera and photography/, ['"shop"~"mobile_phone|electronics|computer"'], 3, 40, { chip: true, shop: true }),
  cat('clothing', 'Clothes', '👕', 'clothing store', /clothes|clothing|garments?|boutique|fashion|textiles?|saree|apparel|shoe|footwear|tailor/, /clothing|fashion|apparel|shoe|boutique|textile|tailor|sewing|designer clothing/, ['"shop"~"clothes|boutique|fashion|shoes|tailor|fabric"'], 3, 40, { chip: true, shop: true }),
  cat('jewellery', 'Jewellery', '💍', 'jewellery shop', /jewell?(ery|er|ers)|gold shop|silver shop|diamond/, /jewel|pawn shop|gold/, ['"shop"="jewelry"'], 3, 40),
  cat('furniture', 'Furniture', '🛋', 'furniture store', /furniture|mattress|sofa/, /furniture|mattress|home goods|carpet/, ['"shop"~"furniture|bed|interior"'], 4, 40),
  cat('books', 'Bookstore', '📚', 'bookstore', /book ?(store|shop)|books\b|stationery|stationary/, /bookstore|office supply|library|stationery|publisher/, ['"shop"~"books|stationery"'], 4, 40, { chip: true, shop: true }),
  cat('hardware', 'Hardware', '🧰', 'hardware store', /hardware|paint shop|plumbing|electrician|building material|cement|tiles?|sanitary/, /hardware|paint store|building supply|home improvement|lumber|tile store|lighting store/, ['"shop"~"hardware|doityourself|paint|trade"'], 3, 40, { chip: true, shop: true }),
  cat('salon', 'Salon', '💇', 'salon', /salons?|barber|parlou?rs?|haircut|hair ?cut|beauty|\bspa\b|massage|makeup/, /salon|barber|beauty|hair|spa|massage|nail|makeup/, ['"shop"~"hairdresser|beauty"', '"amenity"="spa"', '"leisure"="spa"'], 2, 30, { chip: true, shop: true }),
  cat('laundry', 'Laundry', '🧺', 'laundry', /laundry|dry ?clean|ironing|washing/, /laundr|dry clean|ironing/, ['"shop"~"laundry|dry_cleaning"'], 4, 30, { chip: true, shop: true }),
  cat('post', 'Post office', '📮', 'post office', /post office|courier|speed post|parcel/, /post office|shipping center|courier|freight/, ['"amenity"="post_office"', '"office"="courier"'], 4, 60),
  cat('library', 'Library', '📖', 'library', /librar(y|ies)|reading room/, /library/, ['"amenity"="library"'], 5, 60),
  cat('school', 'School', '🏫', 'school', /schools?|kindergarten|preschool|play ?school/, /school|kindergarten|preschool|education/, ['"amenity"~"school|kindergarten"'], 3, 40),
  cat('college', 'College', '🎓', 'college', /colleges?|universit(y|ies)|institute|campus|engineering college/, /college|universit|institute|campus|academy/, ['"amenity"~"college|university"'], 4, 60),
  cat('govt', 'Govt office', '🏢', 'government office', /government office|govt office|collector|municipal|panchayat|tehsil|mandal|rto\b|passport (office|seva)|aadhaar|court/, /government|town hall|municipal|courthouse|passport/, ['"office"="government"', '"amenity"~"townhall|courthouse"'], 5, 60),
  cat('juice', 'Juice & coconut', '🥤', 'juice shop', /juice|tender coconut|coconut water|sugarcane|lassi|smoothie|fresh juice|shake/, /juice|smoothie|beverage|coconut|lassi/, ['"amenity"="juice_bar"', '"shop"="beverages"', '"cuisine"~"juice|smoothie"'], 2, 30, { chip: true, shop: true }),
  cat('snacks', 'Snacks & chaat', '🥟', 'snack stall', /snacks?|chaat|pani ?puri|golgappa|street food|samosa|pakora|bajji|vada|bhel|puri stall|tiffin centre/, /snack|chaat|street food|samosa|tiffin/, ['"amenity"="fast_food"]["cuisine"~"snack|street_food|chaat|samosa|indian"', '"shop"="deli"'], 2, 30, { chip: true, shop: true, nameMatch: /chaat|snack|puri|samosa|bhel|vada|bajji/ }),
  cat('florist', 'Flowers', '💐', 'flower shop', /florist|flowers?|flower (shop|stall)|garlands?|bouquet/, /florist|flower|garland|bouquet/, ['"shop"="florist"'], 3, 30, { chip: true, shop: true }),
  cat('xerox', 'Print & xerox', '🖨', 'xerox shop', /xerox|photo ?copy|print(ing)? (shop|out|service)|print ?outs?|cyber ?cafe|internet cafe|lamination|passport photo/, /print|copy|cyber|internet cafe|photo/, ['"shop"="copyshop"', '"amenity"="internet_cafe"', '"craft"="printer"'], 3, 30, { chip: true, shop: true }),
  cat('optician', 'Optical', '👓', 'optical shop', /optical|optician|spectacles?|eye ?glasses|sunglasses|eyewear|eye care|eye hospital/, /optical|optician|eyewear|eye care|sunglasses/, ['"shop"="optician"', '"healthcare"="optometrist"'], 3, 40, { chip: true, shop: true }),
  cat('gifts', 'Gifts & toys', '🎁', 'gift shop', /gifts?|toys?|souvenir|novelty|handicraft/, /gift|toy|souvenir|novelty|handicraft/, ['"shop"~"gift|toys|variety_store|souvenir"'], 3, 40, { chip: true, shop: true }),
  cat('petshop', 'Pet shop', '🐕', 'pet shop', /pet (shop|store|supplies|food)|dog food|aquarium shop/, /pet (store|shop|supplies)|pet food|aquarium/, ['"shop"="pet"'], 4, 50, { chip: true, shop: true }),
  cat('food_store', 'Meat & fish', '🥩', 'meat shop', /meat|chicken (shop|center|centre)|fish (market|shop)|mutton|butcher/, /butcher|meat|fish|seafood market/, ['"shop"~"butcher|seafood"'], 3, 30, { chip: true, shop: true }),
]

// ── qualifiers: what people add to a kind of place ──────────────────────────────

interface Qual { re: string; osm: string; rel?: { food?: string; worship?: string } }
/** `re` is tested against name and kind; `osm` against the cuisine/religion/denomination tags; `rel` is the relaxed tier. */
const QUALS: Record<string, Qual> = {
  chinese: { re: 'chinese|china|schezwan|szechuan|sichuan|hakka|wok|dragon|noodle|dim sum|wonton', osm: 'chinese|asian|noodle', rel: { food: 'asian|thai|korean|tibetan|momo|noodle|oriental', worship: 'buddhist|taoist' } },
  japanese: { re: 'japan|sushi|ramen|udon|tempura|teppan|izakaya|bento|tokyo|osaka|kyoto|sakura|shinto|nippon|zen\\b', osm: 'japanese|sushi|ramen|shinto|zen', rel: { food: 'asian|korean|chinese|thai|oriental', worship: 'buddhist|shinto|zen|taoist' } },
  korean: { re: 'korea|kimchi|bbq|seoul', osm: 'korean', rel: { food: 'asian|japanese|chinese' } },
  thai: { re: 'thai|bangkok|siam', osm: 'thai', rel: { food: 'asian|chinese|vietnamese' } },
  vietnamese: { re: 'vietnam|pho\\b', osm: 'vietnamese', rel: { food: 'asian|thai' } },
  tibetan: { re: 'tibet|momo|thukpa|lhasa', osm: 'tibetan|nepalese', rel: { food: 'asian|nepalese|chinese', worship: 'buddhist' } },
  nepali: { re: 'nepal|momo|thakali', osm: 'nepalese|tibetan', rel: { food: 'tibetan|asian' } },
  italian: { re: 'ital|pizza|pasta|pizzeria|trattoria|la |il ', osm: 'italian|pizza|pasta', rel: { food: 'pizza|mediterranean|continental' } },
  pizza: { re: 'pizza|pizzeria|domino|papa john|pizza hut', osm: 'pizza', rel: { food: 'italian|fast_food' } },
  burger: { re: 'burger|mcdonald|kfc|wendy|burger king|five guys', osm: 'burger', rel: { food: 'american|fast_food|sandwich' } },
  mexican: { re: 'mexic|taco|burrito|nacho|tex.?mex', osm: 'mexican|tex-mex', rel: { food: 'american|latin' } },
  french: { re: 'french|bistro|creperie|patisserie|brasserie', osm: 'french', rel: { food: 'continental|european|italian' } },
  continental: { re: 'continental|european|steak|grill', osm: 'continental|european|international', rel: { food: 'italian|french|american|mediterranean' } },
  american: { re: 'americ|diner|steak|burger|bbq', osm: 'american|burger|steak', rel: { food: 'burger|continental' } },
  arabian: { re: 'arab|shawarma|mandi|kebab|lebanese|middle east|turk|persian|shami|falafel|grill', osm: 'arab|lebanese|turkish|persian|kebab|middle_eastern|mediterranean', rel: { food: 'mughlai|kebab|mediterranean|turkish' } },
  lebanese: { re: 'leban|shawarma|falafel|hummus', osm: 'lebanese|arab|middle_eastern|mediterranean', rel: { food: 'arab|turkish|mediterranean' } },
  turkish: { re: 'turk|kebab|doner|istanbul', osm: 'turkish|kebab', rel: { food: 'arab|lebanese|mediterranean' } },
  mediterranean: { re: 'mediterran|greek|lebanese|falafel', osm: 'mediterranean|greek|lebanese', rel: { food: 'arab|italian|turkish' } },
  indian: { re: 'indian|bhojan|bhavan|andhra|punjabi|tandoor|biryani|thali|dhaba', osm: 'indian|north_indian|south_indian|regional|andhra|biryani', rel: { food: 'regional|vegetarian' } },
  'north indian': { re: 'north indian|punjabi|mughlai|tandoor|dhaba|delhi|lucknow', osm: 'north_indian|punjabi|mughlai|indian', rel: { food: 'indian|regional' } },
  'south indian': { re: 'south indian|andhra|udupi|dosa|idli|tamil|kerala|chettinad|karnataka|telugu|tiffin|mess|meals|vada|saravana|adyar|woodlands', osm: 'south_indian|andhra|dosa|udupi|tamil|kerala|chettinad|indian', rel: { food: 'indian|regional|vegetarian' } },
  punjabi: { re: 'punjab|dhaba|tandoor|amritsar|lassi', osm: 'punjabi|north_indian|indian', rel: { food: 'indian' } },
  mughlai: { re: 'mughlai|nawabi|awadhi|kebab|tandoor', osm: 'mughlai|north_indian|indian', rel: { food: 'indian|arab' } },
  hyderabadi: { re: 'hyderabad|biryani|haleem|bawarchi|paradise|nawab|dum|shah ghouse|cafe bahar', osm: 'hyderabadi|biryani|indian', rel: { food: 'indian|mughlai|biryani' } },
  biryani: { re: 'biryani|biriyani|dum|paradise|bawarchi|behrouz|pista house|shah ghouse', osm: 'biryani|hyderabadi|indian|mughlai', rel: { food: 'indian|mughlai' } },
  andhra: { re: 'andhra|guntur|gongura|telugu|ruchulu|bhojanam', osm: 'andhra|south_indian|indian', rel: { food: 'south_indian|indian' } },
  kerala: { re: 'kerala|malabar|mallu|appam|sadya|thalassery', osm: 'kerala|south_indian', rel: { food: 'south_indian|seafood' } },
  bengali: { re: 'bengal|kolkata|calcutta|kosha|fish curry', osm: 'bengali|indian', rel: { food: 'indian|seafood' } },
  gujarati: { re: 'gujarat|thali|farsan|dhokla', osm: 'gujarati|indian', rel: { food: 'indian|vegetarian' } },
  rajasthani: { re: 'rajasthan|marwar|dal baati|thali', osm: 'rajasthani|indian', rel: { food: 'indian|vegetarian' } },
  seafood: { re: 'seafood|fish|prawn|crab|coastal|mangalorean|konkan', osm: 'seafood|fish', rel: { food: 'indian|coastal' } },
  vegetarian: { re: 'vegetarian|\\bveg\\b|pure veg|jain|sattvik|udupi|bhavan', osm: 'vegetarian|vegan', rel: { food: 'indian|south_indian' } },
  vegan: { re: 'vegan|plant.based', osm: 'vegan|vegetarian', rel: { food: 'vegetarian' } },
  sushi: { re: 'sushi|japan|ramen|izakaya', osm: 'sushi|japanese', rel: { food: 'japanese|asian|korean|chinese' } },
  ramen: { re: 'ramen|noodle|japan', osm: 'ramen|japanese|noodle', rel: { food: 'japanese|asian|chinese' } },
  noodles: { re: 'noodle|chinese|wok|hakka|ramen', osm: 'noodle|chinese|asian', rel: { food: 'asian|chinese' } },
  momos: { re: 'momo|tibet|nepal|dumpling', osm: 'momo|tibetan|nepalese|chinese', rel: { food: 'asian|tibetan|chinese' } },
  dosa: { re: 'dosa|idli|udupi|tiffin|south indian|bhavan|mess', osm: 'dosa|south_indian|udupi|indian', rel: { food: 'south_indian|indian|vegetarian' } },
  shawarma: { re: 'shawarma|arab|kebab|mandi|turk|lebanese', osm: 'shawarma|arab|kebab|lebanese|turkish', rel: { food: 'arab|kebab|mediterranean' } },
  kebab: { re: 'kebab|kabab|tandoor|grill|shawarma', osm: 'kebab|grill|arab', rel: { food: 'mughlai|arab|bbq' } },
  pasta: { re: 'pasta|italian|pizza', osm: 'pasta|italian|pizza', rel: { food: 'italian|continental' } },
  halal: { re: 'halal|mughlai|arab|biryani', osm: 'halal|arab|mughlai|biryani', rel: { food: 'arab|mughlai' } },
  bbq: { re: 'bbq|barbecue|barbeque|grill|tandoor|kebab', osm: 'barbecue|grill|kebab', rel: { food: 'steak|kebab' } },
  buffet: { re: 'buffet|unlimited|all you can eat', osm: 'buffet' },
  // places of worship
  hindu: { re: 'hindu|temple|mandir|devasth|devalay|gudi|kovil|alayam|shiv|ganesh|hanuman|rama|krishna|venkatesw|balaji|durga|lakshmi|ayyappa|murugan|sai', osm: 'hindu' },
  muslim: { re: 'muslim|masjid|mosque|jamia|dargah|idgah|islam', osm: 'muslim' },
  islamic: { re: 'muslim|masjid|mosque|jamia|dargah|islam', osm: 'muslim' },
  christian: { re: 'christian|church|cathedral|chapel|baptist|catholic|csi|methodist|pentecostal', osm: 'christian' },
  catholic: { re: 'catholic|roman|cathedral|basilica|st\\.? ', osm: 'catholic|roman_catholic|christian', rel: { worship: 'christian' } },
  buddhist: { re: 'buddhist|buddha\\b|buddhism|stupa|monastery|tibetan|dhamma|maha ?bodhi|pagoda|vihara', osm: 'buddhist' },
  jain: { re: 'jain|derasar|basadi|mahavir', osm: 'jain' },
  sikh: { re: 'sikh|gurdwara|gurudwara|singh sabha', osm: 'sikh' },
  shinto: { re: 'shinto|jinja|torii', osm: 'shinto', rel: { worship: 'buddhist|japanese' } },
  shiva: { re: 'shiv|shiva|shankar|mahadev|eshwar|ishwar|lingam|rameshwar|nageshwar|someshwar|kedar', osm: 'shiva', rel: { worship: 'hindu' } },
  ganesh: { re: 'ganesh|vinayak|ganapati|pillaiyar', osm: 'ganesh|ganesha', rel: { worship: 'hindu' } },
  hanuman: { re: 'hanuman|anjaneya|anjaneyaswamy|maruti|bajrang', osm: 'hanuman', rel: { worship: 'hindu' } },
  balaji: { re: 'balaji|venkateswara|venkateshwara|venkatesh|tirupati|perumal|tirumala', osm: 'venkateswara|balaji|vishnu', rel: { worship: 'hindu' } },
  sai: { re: 'sai ?baba|shirdi|sai mandir|sai temple', osm: 'sai_baba|sai', rel: { worship: 'hindu' } },
  iskcon: { re: 'iskcon|hare krishna|radha|krishna', osm: 'iskcon|krishna', rel: { worship: 'hindu' } },
  // fuel and general descriptors
  government: { re: 'govt|government|municipal|district|primary health|phc|civil|general hospital|area hospital', osm: 'government|public' },
}
/** Words that describe a place without naming one. */
const DESCRIPTORS = new Set(['good', 'best', 'top', 'nice', 'famous', 'popular', 'cheap', 'budget', 'open', 'late', 'night', 'family', 'luxury', 'big', 'small',
  'local', 'street', 'veg', 'non', 'pure', 'electric', 'fast', 'authentic', 'famous', 'rated', 'highly', 'place', 'places', 'spot', 'shop', 'shops', 'store', 'center', 'centre', 'near', 'new', 'old', 'ancient', 'lowest', 'cheapest', 'vegetarian', 'private', 'diesel', 'petrol', 'cng', '24x7', '24', 'hours', 'hour', 'station', 'stations', 'stop', 'stand', 'point', 'pump', 'pumps', 'bunk'])
const QUAL_TOKENS = new Set<string>([...Object.keys(QUALS).flatMap(k => k.split(' ')), ...DESCRIPTORS])

/** Words to drop before looking for the kind of place. */
const FILLER = new RegExp('\\b(' + [
  'hey|hi|ok|okay|hello|meta|metta|mehta|maps|gemini', 'please|pls|can you|could you|would you|will you|let\'?s|lets',
  'i want to|i wanna|i would like to|i\'d like to|i need to|i need|i want|i\'m looking for|i am looking for|looking for|searching for|search for|search',
  'show me|find me|find|get me to|get me|take me to|take me|navigate to|navigate|directions to|drive to|route to|go to|head to|how to get to',
  'where\'?s|where is|where are|where can i (find|get|go)|where do i find|where|what|which|is there|are there|do you know|tell me|any',
  'the|a|an|any|some|nearest|nearby|near by|closest|near me|near us|around me|around here|close by|close to me|close to us|near here|around|here|within|walking distance|to|for|me|my|us|our|of|in|on|at|from|there|i|am|is|are|do|you|can|go|visit|see|get|have|some',
  'around me|asap|right now|now|today|tonight|quickly|fast',
].join('|') + ')\\b', 'gi')

/** Speech engines mishear a few common words; fix the ones that matter. */
const FIXES: [RegExp, string][] = [
  [/\bbeech\b|\bbeaches?\b/g, 'beach'], [/\bpeach\b(?= (near|nearby|here))/g, 'beach'],
  [/\bchines\b|\bchinies\b|\bchinese's\b/g, 'chinese'], [/\bjapan\b(?! (temple|restaurant|food))/g, 'japanese'],
  [/\bdominoes\b|\bdomino's\b/g, 'dominos'], [/\bmac ?donald'?s\b/g, 'mcdonalds'], [/\bk f c\b/g, 'kfc'],
  [/\batm's\b|\ba t m\b/g, 'atm'], [/\bpetrol bunk\b|\bgas pump\b/g, 'petrol pump'],
]

export interface NearQuery {
  /** the kind of place; a name-search category when only a name was given */
  cat: NearCat | null
  /** qualifier words in the order spoken, e.g. ['japanese'] */
  quals: string[]
  /** what is left after dropping filler, e.g. "japanese temple" */
  phrase: string
  /** words left over that are neither the kind nor a known qualifier (a brand like apollo) */
  extra: string[]
  /** true when only a brand or place name was given (no kind of place) */
  nameOnly: boolean
  /** a readable description: "Japanese temple" */
  label: string
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Everything left of a spoken phrase once the filler words are gone. */
export function cleanPhrase(speech: string): string {
  let s = ' ' + speech.toLowerCase().replace(/[.?!,;:]/g, ' ').replace(/\s+/g, ' ') + ' '
  for (const [re, to] of FIXES) s = s.replace(re, to)
  return s.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
}

/** Turn what was said into a kind of place and qualifiers. */
export function parseNear(speech: string): NearQuery {
  const phrase = cleanPhrase(speech)
  if (!phrase) return { cat: null, quals: [], phrase, extra: [], nameOnly: false, label: '' }
  let head: NearCat | null = null
  let rest = ' ' + phrase + ' '
  // a multi-word qualifier is taken whole ("south indian"), then single words
  const quals: string[] = []
  for (const k of Object.keys(QUALS).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${esc(k)}\\b`)
    if (re.test(rest)) { quals.push(k); rest = rest.replace(re, ' ') }
  }
  for (const c of NEAR_CATS) {
    const m = rest.match(c.words)
    if (m) { head = c; rest = rest.replace(new RegExp(c.words.source, 'g'), ' '); break }
  }
  // "chinese", "biryani", "pizza" alone mean a restaurant of that kind
  if (!head && quals.some(q => QUALS[q].rel?.food || /^(chinese|biryani|pizza|burger|seafood|indian)$/.test(q))) {
    head = NEAR_CATS.find(c => c.id === 'food') ?? null
  }
  const leftovers = rest.split(' ').filter(w => w.length > 1 && !DESCRIPTORS.has(w))
  if (head) {
    // unknown extra words (a brand: "apollo", "dominos") must also appear in the name
    const extra = leftovers.filter(w => !QUAL_TOKENS.has(w))
    const all = [...quals, ...extra]
    const label = [...all, head.say].join(' ')
    return { cat: head, quals: all, phrase, extra, nameOnly: false, label: cap(label) }
  }
  // no kind of place: a brand or a name ("dominos", "reliance fresh")
  const name = phrase.split(' ').filter(w => !DESCRIPTORS.has(w)).join(' ').trim()
  if (name.length >= 3) {
    // tolerate apostrophes and plurals (dominos / Domino's, mcdonalds / McDonald's)
    const re = norm(name).split(' ').map(w => esc(w.length > 5 ? w.slice(0, -1) : w)).join('.*')
    return {
      cat: cat('name', cap(name), '📍', name, /$^/, /$^/, [`"name"~"${re}",i`], 3, 60),
      quals: [], phrase, extra: [], nameOnly: true, label: cap(name),
    }
  }
  return { cat: null, quals, phrase, extra: [], nameOnly: false, label: '' }
}

/** True when the phrase asks for a kind of place, not one particular named place. */
export function isCategoryRequest(speech: string): boolean {
  const q = parseNear(speech)
  // every word beyond the kind must be a known qualifier or descriptor, not a name
  return !!q.cat && !q.nameOnly && q.extra.length === 0
}

// ── searching ────────────────────────────────────────────────────────────────

export interface NearHit extends Place { km: number; tier?: 'exact' | 'related' | 'category' }
export interface NearResult { hits: NearHit[]; level: 'exact' | 'related' | 'category' | 'none'; query: NearQuery }

const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dx = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot(dx, b.lat - a.lat) * 111.2
}

const qualRe = (q: string, i = 're') => {
  const spec = QUALS[q]
  return new RegExp(spec ? (spec as any)[i] : esc(q), 'i')
}

function tierOf(q: NearQuery, text: string, tagText: string): 'exact' | 'related' | 'category' {
  if (!q.quals.length) return 'exact'
  const all = (text + ' ' + tagText).toLowerCase()
  const exact = q.quals.every(k => {
    const spec = QUALS[k]
    if (!spec) return new RegExp(`\\b${esc(norm(k))}`, 'i').test(norm(all))
    return new RegExp('\\b(?:' + spec.re + ')', 'i').test(all) || (!!tagText && new RegExp('\\b(?:' + spec.osm + ')', 'i').test(tagText))
  })
  if (exact) return 'exact'
  const g = q.cat?.group
  const related = g && q.quals.some(k => { const r = QUALS[k]?.rel?.[g]; return r && new RegExp('\\b(?:' + r + ')', 'i').test(all) })
  return related ? 'related' : 'category'
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

async function overpassRaw(ql: string): Promise<any[] | null> {
  for (const url of ENDPOINTS) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 13000)
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(ql), signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      if (!r.ok) continue
      const j = await r.json()
      // an overloaded server answers 200 with a remark and no elements: try the next one
      if (j.remark && !(j.elements ?? []).length) continue
      return j.elements ?? []
    } catch { /* try the next server */ } finally { clearTimeout(t) }
  }
  return null
}

/** Kinds that are often unnamed on the map but still worth finding. */
const UNNAMED_OK = new Set(['fuel', 'atm', 'parking', 'toilet', 'bus', 'ev', 'beach', 'lake', 'waterfall', 'hill', 'park', 'zoo', 'fort', 'mosque', 'church', 'temple'])

function fromElements(els: any[], q: NearQuery, at: { lat: number; lng: number }): NearHit[] {
  const cat = q.cat!
  return els.flatMap((e: any) => {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon
    if (lat == null || lng == null) return []
    const tg = e.tags ?? {}
    const name = tg.name || tg['name:en'] || tg.brand || tg.operator
    if (!name && !UNNAMED_OK.has(cat.id)) return [] // unnamed spots are no use to navigate to
    const tagText = [tg.cuisine, tg.religion, tg.denomination, tg.brand, tg.description, tg.fuel, tg['name:en']].filter(Boolean).join(' ').replace(/_/g, ' ')
    const tier = tierOf(q, name ?? '', tagText)
    const sub = [tg.cuisine && cap(String(tg.cuisine).replace(/[;_]/g, ', ')), tg.religion && cap(tg.religion), tg['addr:street'], tg['addr:suburb'] || tg['addr:city']]
      .filter(Boolean).join(' · ') || cat.label
    return [{ name: name || cat.label, sub, lat, lng, km: dist(at, { lat, lng }), tier } as NearHit]
  })
}

/** Build the Overpass query for one radius. `mode` picks how the first qualifier is applied. */
function overpassQuery(q: NearQuery, at: { lat: number; lng: number }, radiusKm: number, mode: 'strict' | 'related' | 'plain'): string {
  const cat = q.cat!
  const around = `(around:${Math.round(radiusKm * 1000)},${at.lat.toFixed(5)},${at.lng.toFixed(5)})`
  const first = q.quals[0]
  const spec = first ? QUALS[first] : undefined
  const lines: string[] = []
  for (const f of cat.osm) {
    if (!first || mode === 'plain') { lines.push(`nwr${around}[${f}];`); continue }
    const safe = (x: string) => x.replace(/\\b/g, '').replace(/\\\.\?/g, '').replace(/\\/g, '').replace(/"/g, '')
    const nameRe = safe(spec ? spec.re : esc(first))
    const tagRe = safe(mode === 'related' ? (spec?.rel?.[cat.group ?? 'food'] ?? '') : spec?.osm ?? esc(first))
    if (mode === 'strict') lines.push(`nwr${around}[${f}]["name"~"${nameRe}",i];`)
    if (tagRe) for (const key of ['cuisine', 'religion', 'denomination', 'brand', 'description']) lines.push(`nwr${around}[${f}]["${key}"~"${tagRe}",i];`)
  }
  return `[out:json][timeout:20];(${lines.join('')});out center 120;`
}

const RADII = [1.5, 3, 6, 12, 25, 50, 100, 200, 400, 700]

async function overpassSearch(q: NearQuery, at: { lat: number; lng: number }, mode: 'strict' | 'related' | 'plain', want: number): Promise<NearHit[] | null> {
  const cat = q.cat!
  const radii = RADII.filter(r => r >= cat.start * 0.99 && r <= cat.max * 1.01)
  if (!radii.length) radii.push(cat.max)
  for (const r of radii) {
    const els = await overpassRaw(overpassQuery(q, at, r, mode))
    if (els === null) return null              // every server failed
    const hits = fromElements(els, q, at).filter(h => mode === 'plain' ? true : h.tier !== 'category')
    if (hits.length >= want) return hits
    if (hits.length && r >= cat.max) return hits
    // found a few at this radius: one wider look would only help when it is cheap
    if (hits.length) return hits
  }
  return []
}

function dedupe(list: NearHit[], limit: number): NearHit[] {
  const seen: NearHit[] = []
  for (const h of list) {
    if (seen.some(s => dist(s, h) < 0.05 || (s.name.toLowerCase() === h.name.toLowerCase() && dist(s, h) < 0.15))) continue
    seen.push(h)
    if (seen.length >= limit) break
  }
  return seen
}

/** Kinds whose words in a name are a reliable sign of what a place is. */
const STRONG = new Set(['pharmacy', 'hospital', 'clinic', 'dentist', 'temple', 'mosque', 'church', 'gurdwara', 'bank', 'atm', 'school', 'college', 'cinema', 'fuel', 'police', 'gym', 'bus', 'train', 'airport', 'library', 'post'])
/** The place data is noisy (a pharmacy filed as a bus station). A name that clearly says another kind is dropped. */
function nameConflicts(c: NearCat, name: string): boolean {
  const n = name.toLowerCase()
  if (c.words.test(n) || (c.nameMatch && c.nameMatch.test(n))) return false
  if (c.nameDeny && c.nameDeny.test(n)) return true
  return NEAR_CATS.some(o => o.id !== c.id && STRONG.has(o.id) && o.words.test(n))
}

/** Kinds where offline pins are unreliable enough that OpenStreetMap, when it answers, has the final say. */
const DROP_UNCONFIRMED = new Set(['beach', 'waterfall', 'lake', 'hill', 'zoo', 'airport', 'museum', 'fort'])
const HEAVY_UNCONFIRMED = new Set(['park', 'mall', 'hospital', 'train', 'metro', 'stadium', 'college', 'bus'])

/** Closest places for a spoken or typed request, in honest tiers. */
export async function searchNearby(speech: string | NearQuery, at: { lat: number; lng: number }, limit = 6): Promise<NearResult> {
  const q = typeof speech === 'string' ? parseNear(speech) : speech
  if (!q.cat) return { hits: [], level: 'none', query: q }
  const cat = q.cat
  const pool: NearHit[] = []

  // 1. the offline India place cells: instant
  if (inIndia(at.lat, at.lng)) {
    const rows = await rowsNear(at).catch(() => [])
    const nameRe = q.nameOnly ? new RegExp(cat.osm[0].match(/~"(.*)",i/)?.[1] ?? '$^', 'i') : null
    for (const r of rows) {
      if (r.k !== 'P') continue
      const parts = r.sub.split(',')
      const kind = parts[0].toLowerCase()
      let ok = false
      if (nameRe) ok = nameRe.test(norm(r.name))
      else {
        ok = (cat.match.test(kind) && !(cat.deny && cat.deny.test(kind))) || (!!cat.nameMatch && WORSHIP_VAGUE.test(kind) && cat.nameMatch.test(r.name.toLowerCase()))
        if (ok && nameConflicts(cat, r.name)) ok = false
      }
      if (!ok) continue
      const km = dist(at, r)
      if (km > cat.max) continue
      const tier = nameRe ? 'exact' : tierOf(q, r.name + ' ' + kind, '')
      pool.push({ name: r.name, sub: parts.slice(1).join(',').trim() || parts[0] || cat.label, lat: r.lat, lng: r.lng, km, tier })
    }
  }
  const best = () => {
    const ex = pool.filter(h => h.tier === 'exact'), rel = pool.filter(h => h.tier === 'related')
    return { ex, rel }
  }
  let { ex } = best()
  ex.sort((a, b) => a.km - b.km)

  // 2. OpenStreetMap, asked at the same time. Its tags are more accurate than the offline kinds,
  //    so a place both agree on ranks higher, and a slow server never holds up an answer for long.
  const livePromise = overpassSearch(q, at, 'strict', 3)
  const slow = new Promise<'slow'>(r => setTimeout(() => r('slow'), 4500))
  const liveRes = await Promise.race([livePromise, slow])
  let liveFailed = liveRes === null
  const live = Array.isArray(liveRes) ? liveRes.filter(h => !q.nameOnly ? !nameConflicts(cat, h.name) : true) : []
  if (live.length && !q.nameOnly && DROP_UNCONFIRMED.has(cat.id)) {
    // beaches, lakes, airports…: the offline pins are often misplaced, so only places OpenStreetMap confirms count
    for (let i = pool.length - 1; i >= 0; i--) if (!live.some(l => dist(pool[i], l) < 0.15)) pool.splice(i, 1)
  }
  if (live.length) {
    const offline = pool.slice()
    for (const o of offline) {
      const confirmed = live.some(l => dist(o, l) < 0.12)
      ;(o as any).rank = o.km * (confirmed ? 0.85 : HEAVY_UNCONFIRMED.has(cat.id) ? 2.5 : 1.15)
    }
    for (const l of live) {
      if (offline.some(o => dist(o, l) < 0.12)) continue   // already there
      ;(l as any).rank = l.km * 0.95
      pool.push(l)
    }
  }
  ;({ ex } = best())
  if (!ex.length && q.quals.length && !liveFailed && liveRes !== 'slow') {
    const rel = await overpassSearch(q, at, 'related', 2)
    if (rel) pool.push(...rel)
  }
  if (!pool.some(h => h.tier !== 'category') && !liveFailed && liveRes !== 'slow') {
    const plain = await overpassSearch(q, at, 'plain', 3)
    if (plain) pool.push(...plain.filter(h => !nameConflicts(cat, h.name)))
  }
  const byRank = (a: NearHit, b: NearHit) => ((a as any).rank ?? a.km) - ((b as any).rank ?? b.km)
  const exact = dedupe(pool.filter(h => h.tier === 'exact').sort(byRank), limit)
  if (exact.length) return { hits: exact, level: 'exact', query: q }
  const related = dedupe(pool.filter(h => h.tier === 'related').sort(byRank), limit)
  if (related.length) return { hits: related, level: 'related', query: q }
  const plain = dedupe(pool.sort(byRank), limit)
  if (plain.length) return { hits: plain.map(h => ({ ...h, tier: 'category' as const })), level: 'category', query: q }
  return { hits: [], level: 'none', query: q }
}

/** The Nearby chips: a category with no qualifier. */
export async function findNearest(c: NearCat, at: { lat: number; lng: number }, limit = 6): Promise<NearHit[]> {
  const q: NearQuery = { cat: c, quals: [], phrase: c.say, extra: [], nameOnly: false, label: cap(c.say) }
  return (await searchNearby(q, at, limit)).hits
}

export const fmtDist = (km: number) => km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} metres` : km < 10 ? `${km.toFixed(1)} kilometres` : `${Math.round(km)} kilometres`
