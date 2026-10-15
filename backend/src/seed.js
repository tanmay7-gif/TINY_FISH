const { db, reset } = require('./db');

function seedData() {
  const user = db.prepare('INSERT INTO users (name, role, pincode, phone) VALUES (?,?,?,?)');
  user.run('Hunar Admin', 'ADMIN', '110001', '9000000001');             // 1
  user.run('Aarav (Buyer, Delhi)', 'BUYER', '110001', '9000000002');    // 2
  user.run('Meera Devi (Potter, Jaipur)', 'ARTISAN', '302001', '9000000003'); // 3
  user.run('Sunita (Madhubani artist, Delhi)', 'ARTISAN', '110020', '9000000004'); // 4
  user.run('Raju (Beat maker, Bengaluru)', 'ARTISAN', '560001', '9000000005'); // 5
  user.run('Sana (Buyer, Chennai)', 'BUYER', '600001', '9000000006');   // 6
  user.run('Fatima Begum (Mehndi artist, Jaipur)', 'ARTISAN', '302002', '9000000007'); // 7
  user.run('Mohan Khan (Folk Singer, Jodhpur)', 'ARTISAN', '342001', '9000000008'); // 8
  user.run('Rameshwar Sahu (Dokra Craftsperson, Delhi)', 'ARTISAN', '110019', '9000000009'); // 9

  const product = db.prepare(
    `INSERT INTO products
     (artisan_id, name, description, kind, price, weight_grams, length_cm, width_cm, height_cm, fragile, stock, download_url, image_url)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  // Keep original IDs 1, 2, 3, 4
  product.run(
    3,
    'Blue Pottery Vase',
    'Hand-painted Jaipur blue pottery vase made from quartz stone and glass frit.',
    'PHYSICAL',
    1299,
    1200,
    20,
    20,
    25,
    1,
    10,
    null,
    'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80'
  ); // 1

  product.run(
    4,
    'Madhubani Painting (A3 print)',
    'Folk art on handmade lokta paper depicting motifs of peacocks, lotus, and the tree of life.',
    'PHYSICAL',
    899,
    300,
    42,
    30,
    3,
    0,
    15,
    null,
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80'
  ); // 2

  product.run(
    4,
    'Handwoven Cotton Stole',
    'Soft handloom cotton stole with hand-painted Madhubani floral border.',
    'PHYSICAL',
    650,
    250,
    30,
    20,
    5,
    0,
    20,
    null,
    'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=600&auto=format&fit=crop&q=80'
  ); // 3

  product.run(
    5,
    'Lo-fi Beat Pack (Non-exclusive License)',
    'Five lo-fi beats with Indian flute, tabla and sitar samples with royalty-free license contract.',
    'AUDIO',
    1999,
    0,
    0,
    0,
    0,
    0,
    0,
    'https://example.com/downloads/lofi-beat-pack.zip',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80'
  ); // 4

  // Additional realistic products
  product.run(
    3,
    'Ceramic Handi & Chai Kulhads (Set of 4)',
    'Authentic glazed terracotta chai cups with cobalt blue peacock motifs.',
    'PHYSICAL',
    599,
    900,
    15,
    15,
    12,
    1,
    12,
    null,
    'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=80'
  ); // 5

  product.run(
    7,
    'Organic Rajasthani Henna Cones (Pack of 6)',
    'Triple-sifted Sojat henna cones with natural eucalyptus and lavender essential oils. Rich mahogany stain.',
    'PHYSICAL',
    349,
    280,
    18,
    12,
    4,
    0,
    25,
    null,
    'https://images.unsplash.com/photo-1600093463592-8e36ae95ef56?w=600&auto=format&fit=crop&q=80'
  ); // 6

  product.run(
    8,
    'Thar Folk Vocal Loops & Sarangi Stems',
    'High definition 24-bit 48kHz audio stems featuring raw Manganiyar celebratory vocals and acoustic sarangi.',
    'AUDIO',
    1499,
    0,
    0,
    0,
    0,
    0,
    0,
    'https://example.com/downloads/thar-folk-stems.zip',
    'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80'
  ); // 7

  product.run(
    9,
    'Dhokra Lost-Wax Brass Tribal Musician',
    'Cast bronze bell metal tribal flutist handmade using traditional lost wax technique by Bastar craftsmen.',
    'PHYSICAL',
    1850,
    850,
    12,
    10,
    22,
    0,
    8,
    null,
    'https://images.unsplash.com/photo-1582562124811-c09040d0a901?w=600&auto=format&fit=crop&q=80'
  ); // 8

  const hub = db.prepare('INSERT INTO hubs (name, type, address, pincode) VALUES (?,?,?,?)');
  hub.run('Jaipur Craft Collective', 'NGO centre', 'Bapu Bazaar, Jaipur', '302003');
  hub.run('Sanganer Post Office', 'Post office', 'Sanganer, Jaipur', '302029');
  hub.run('Lajpat Nagar Pack and Ship', 'Local shop', 'Lajpat Nagar, Delhi', '110024');
  hub.run('Dilli Haat Artisan Desk', 'NGO centre', 'INA, Delhi', '110023');

  // Creators
  const insertCreator = db.prepare(
    `INSERT INTO creators (user_id, display_name, art_form, city, bio, photo_url, languages, verified)
     VALUES (?,?,?,?,?,?,?,?)`
  );

  const c1 = insertCreator.run(
    3,
    'Meera Devi',
    'Jaipur Blue Pottery',
    'Jaipur',
    '3rd generation master artisan preserving Persian-Jaipuri blue pottery. Each piece is hand-thrown and painted using quartz stone powder, natural cobalt, and copper oxide.',
    'https://images.unsplash.com/photo-1544717305-2782549b5136?w=400&auto=format&fit=crop&q=80',
    'Hindi, Rajasthani, English',
    1
  );

  const c2 = insertCreator.run(
    4,
    'Sunita Kumari',
    'Madhubani Folk Painting',
    'Delhi',
    'Mithila folk artist capturing ancient mythological narratives, river wildlife, and bridal rituals using natural twig nibs and organic leaf and turmeric pigments.',
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80',
    'Hindi, Maithili',
    1
  );

  const c3 = insertCreator.run(
    5,
    'Raju Beats',
    'Desi Lo-fi & Audio Production',
    'Bengaluru',
    'Sound engineer and producer fusing hip-hop grooves with soulful acoustic recordings of bansuri, sitar, and tabla recorded across India.',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    'Kannada, Hindi, English',
    1
  );

  const c4 = insertCreator.run(
    7,
    'Fatima Begum',
    'Organic Rajasthani Mehndi',
    'Jaipur',
    'Bridal henna artist with 14 years of heritage experience. Specializes in intricate Mughal peacocks, jali patterns, and 100% natural Sojat organic henna.',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
    'Hindi, Urdu, Marwari',
    1
  );

  const c5 = insertCreator.run(
    8,
    'Mohan Khan Manganiyar',
    'Thar Desert Folk Musician',
    'Jodhpur',
    'Hereditary Manganiyar folk musician performing royal Marwari ballads, desert Sufi qawwalis, and classical Kamaicha recitals.',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80',
    'Marwari, Hindi',
    1
  );

  const c6 = insertCreator.run(
    9,
    'Rameshwar Sahu',
    'Dhokra Lost-Wax Bell Metalcraft',
    'Delhi',
    'National craft awardee reviving ancient 4,000-year-old Harappan lost-wax casting. Crafting brass tribal musicians, animals, and rustic temple oil lamps.',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
    'Hindi, Chhattisgarhi',
    0
  );

  // Showcase items
  const insertShowcase = db.prepare(
    `INSERT INTO showcase_items (creator_id, type, url, title, description, created_at)
     VALUES (?,?,?,?,?,?)`
  );
  const now = new Date().toISOString();

  // Meera Devi showcase (id: c1.lastInsertRowid)
  insertShowcase.run(
    c1.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&auto=format&fit=crop&q=80',
    'Shaping the Persian Vase',
    'Hand-kneading quartz powder dough and casting in open plaster molds.',
    now
  );
  insertShowcase.run(
    c1.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800&auto=format&fit=crop&q=80',
    'Cobalt & Copper Freehand Painting',
    'Drawing delicate peacock feathers with squirrel-hair brushes before firing.',
    now
  );
  insertShowcase.run(
    c1.lastInsertRowid,
    'VIDEO',
    'https://assets.mixkit.co/videos/preview/mixkit-hands-of-a-potter-shaping-a-clay-vase-41584-large.mp4',
    'Wheel Throwing at Sunrise',
    'Watch the delicate clay and quartz take form on the traditional manual wheel.',
    now
  );

  // Sunita Kumari showcase (id: c2.lastInsertRowid)
  insertShowcase.run(
    c2.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80',
    'Mithila Kohbar Wedding Mural',
    'Auspicious bridal chamber art painted using bamboo sticks and natural indigo.',
    now
  );
  insertShowcase.run(
    c2.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1582562124811-c09040d0a901?w=800&auto=format&fit=crop&q=80',
    'Grinding Palak & Haritaki for Natural Green',
    'Extracting organic dyes without artificial chemical binders.',
    now
  );

  // Raju Beats showcase (id: c3.lastInsertRowid)
  insertShowcase.run(
    c3.lastInsertRowid,
    'VIDEO',
    'https://assets.mixkit.co/videos/preview/mixkit-hands-playing-a-synthesizer-in-a-studio-43187-large.mp4',
    'Sampling Indian Classical Tabla',
    'Microphone placement and acoustic chop session for the Monsoon Rain beat pack.',
    now
  );
  insertShowcase.run(
    c3.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=800&auto=format&fit=crop&q=80',
    'Bengaluru Underground Bedroom Studio',
    'Where analog tape saturation meets modern digital audio workstations.',
    now
  );

  // Fatima Begum showcase (id: c4.lastInsertRowid)
  insertShowcase.run(
    c4.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1600093463592-8e36ae95ef56?w=800&auto=format&fit=crop&q=80',
    'Royal Rajasthani Bridal Jali',
    'Over 6 hours of geometric lace and lotus motifs applied for a Jaipur wedding.',
    now
  );

  // Mohan Khan showcase (id: c5.lastInsertRowid)
  insertShowcase.run(
    c5.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
    'Tuning the Kamaicha in Thar Dunes',
    'Carved from a single piece of mango wood with 17 steel strings.',
    now
  );

  // Rameshwar Sahu showcase (id: c6.lastInsertRowid)
  insertShowcase.run(
    c6.lastInsertRowid,
    'IMAGE',
    'https://images.unsplash.com/photo-1544717305-2782549b5136?w=800&auto=format&fit=crop&q=80',
    'Beeswax Thread Wrapping',
    'Creating wax coil textures over the clay core before pouring molten bronze.',
    now
  );
}

module.exports = { seedData };

if (require.main === module) {
  reset();
  seedData();
  console.log('Seeded creators, showcase items, products, and users successfully.');
}
