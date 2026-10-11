-- Extra demo recipients, used only when recording the tutorial video.
-- Applied on top of supabase/seed.sql against the LOCAL stack. Never run in production.
--
-- Every phone number in the video is the same obviously-fake one. A viewer who sees a different
-- number on each screen starts wondering whether they are looking at the same person; and a
-- number that looks real has no business being in something we hand out.

insert into public.deliveries
  (campaign_id, full_name, street, house_number, apartment, floor, entrance, building_code,
   city, neighborhood, household_size, phone, notes, latitude, longitude)
values
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','אסתר מלכה','נחלת בנימין','21','4','1','א','4417','תל אביב','מרכז',3,'050-123-4567',null,32.0637,34.7702),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','יצחק אלבז','נחלת בנימין','25','9','3',null,null,'תל אביב','מרכז',5,'050-123-4567','קומה גבוהה, אין מעלית',32.0640,34.7705),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','מזל סויסה','נחלת בנימין','31','2','0','ב','1180','תל אביב','מרכז',2,'050-123-4567',null,32.0645,34.7708),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','שלמה נחום','נחלת בנימין','38','11','4',null,null,'תל אביב','מרכז',4,'050-123-4567',null,32.0650,34.7711),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','ציפורה בן דוד','לילינבלום','6','1','0',null,'2041','תל אביב','מרכז',1,'050-123-4567',null,32.0625,34.7690),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','מרדכי טויטו','לילינבלום','12','5','2','א',null,'תל אביב','מרכז',6,'050-123-4567','לתאם שעה בטלפון',32.0628,34.7694),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','ויקטוריה אסולין','לילינבלום','18','3','1',null,null,'תל אביב','מרכז',2,'050-123-4567',null,32.0631,34.7697),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','נסים אברג׳יל','יהודה הלוי','44','8','3','ג','7731','תל אביב','מרכז',3,'050-123-4567',null,32.0612,34.7731),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','שושנה כרמלי','יהודה הלוי','50','2','1',null,null,'תל אביב','מרכז',4,'050-123-4567',null,32.0616,34.7735),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','אליהו זריהן','יהודה הלוי','58','6','2','ב',null,'תל אביב','מרכז',2,'050-123-4567',null,32.0621,34.7739),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','פנינה הרוש','מונטיפיורי','9','3','1',null,'3390','תל אביב','מרכז',5,'050-123-4567',null,32.0629,34.7742),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','חיים בן שבת','מונטיפיורי','15','7','3',null,null,'תל אביב','מרכז',1,'050-123-4567',null,32.0633,34.7746),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','אורלי שטרית','אחד העם','27','4','1','א',null,'תל אביב','מרכז',3,'050-123-4567',null,32.0618,34.7700),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','ראובן עטיה','אחד העם','33','10','4',null,'8890','תל אביב','מרכז',4,'050-123-4567','הכלב נובח, לא נושך',32.0622,34.7704),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','תמר ועקנין','אחד העם','41','1','0',null,null,'תל אביב','מרכז',2,'050-123-4567',null,32.0626,34.7708),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','שמחה דיין','בלפור','11','5','2','ב','1902','תל אביב','מרכז',6,'050-123-4567',null,32.0648,34.7724),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','בנימין אוחנה','בלפור','17','2','1',null,null,'תל אביב','מרכז',3,'050-123-4567',null,32.0652,34.7727),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','גילה אדרי','שינקין','22','8','3',null,null,'תל אביב','מרכז',2,'050-123-4567',null,32.0668,34.7718),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','עמרם לוגסי','שינקין','28','3','1','א','5520','תל אביב','מרכז',5,'050-123-4567',null,32.0671,34.7722),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','רוזה חזן','שינקין','34','6','2',null,null,'תל אביב','מרכז',1,'050-123-4567',null,32.0674,34.7726);

update public.deliveries
set phone = '050-123-4567', phone2 = null
where campaign_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
