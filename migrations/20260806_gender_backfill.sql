-- Gender backfill — generated 2026-08-06T05:24:50.904Z from gender-review.csv
-- 136 registration rows (64 male, 72 female).
-- Rows, not people: someone who registered more than once appears once per
-- registration, so don't read these as a headcount.
-- Values were set by hand; nothing here was inferred from names.
--
-- Safe to re-run: each statement only writes when the stored value differs.

BEGIN;

UPDATE public.registrations SET gender = 'male' WHERE id = 'fb46adea-311f-4f39-abb2-f7efb012f766' AND gender IS DISTINCT FROM 'male';  -- Aaron Carl Medina
UPDATE public.registrations SET gender = 'female' WHERE id = '29806a41-4637-4d94-ab2a-ae8cf6f99483' AND gender IS DISTINCT FROM 'female';  -- Aiah O. Yparraguirre
UPDATE public.registrations SET gender = 'female' WHERE id = 'addc140f-3355-4762-89f5-6a749360fca3' AND gender IS DISTINCT FROM 'female';  -- Ailyn Mersa Paquillo
UPDATE public.registrations SET gender = 'male' WHERE id = 'b7f0dec6-4db5-4daa-9adc-5fc87918e4ca' AND gender IS DISTINCT FROM 'male';  -- Alexander Timuat
UPDATE public.registrations SET gender = 'female' WHERE id = '8275fe6a-eeb6-4ad4-8723-94c650e19c91' AND gender IS DISTINCT FROM 'female';  -- Alyssa Vea Pascual
UPDATE public.registrations SET gender = 'female' WHERE id = '717ad9c9-101d-4750-82d0-57800cd9e8ac' AND gender IS DISTINCT FROM 'female';  -- Angel Almanza
UPDATE public.registrations SET gender = 'female' WHERE id = '14d5e289-1509-4867-b88b-32e5d4dbc9a8' AND gender IS DISTINCT FROM 'female';  -- Angelika Joy Jarin
UPDATE public.registrations SET gender = 'male' WHERE id = 'abc3f6de-7720-4b86-a6b3-0353746be5fc' AND gender IS DISTINCT FROM 'male';  -- Arric Chael Z. Bautista
UPDATE public.registrations SET gender = 'male' WHERE id = 'e3565272-b2e2-4acc-9691-013ea3584719' AND gender IS DISTINCT FROM 'male';  -- Arwin Ace D. Cruz
UPDATE public.registrations SET gender = 'female' WHERE id = 'e2a6c817-d1ad-4d30-b474-791877fe384b' AND gender IS DISTINCT FROM 'female';  -- Babie Jean M Paquillo
UPDATE public.registrations SET gender = 'male' WHERE id = 'a4bcc478-ff46-49d6-9fde-53fbe6b90a7f' AND gender IS DISTINCT FROM 'male';  -- Carl Jasper Monzon
UPDATE public.registrations SET gender = 'male' WHERE id = '0471ccc5-a94c-4d40-87fb-9e5c10cc9774' AND gender IS DISTINCT FROM 'male';  -- CHRISTIAN JOY S. MAQUILING
UPDATE public.registrations SET gender = 'female' WHERE id = 'cd1b8911-1e0d-4b49-86f9-3c09f54db832' AND gender IS DISTINCT FROM 'female';  -- Cristine Kate Trabucon
UPDATE public.registrations SET gender = 'female' WHERE id = 'cec710d5-a469-49a1-ac90-e099ce41944b' AND gender IS DISTINCT FROM 'female';  -- DONNA BHELL P. MAQUILING
UPDATE public.registrations SET gender = 'female' WHERE id = '06cb76dc-34e3-4655-bc94-1d16fe3ff885' AND gender IS DISTINCT FROM 'female';  -- Duffny Faith B. Sarim
UPDATE public.registrations SET gender = 'male' WHERE id = '09d0b8d0-6f96-4730-bd4a-c428cdc9857b' AND gender IS DISTINCT FROM 'male';  -- EDFEL F. VARRON
UPDATE public.registrations SET gender = 'male' WHERE id = '5db1103c-2166-4c90-a05c-397d1303b429' AND gender IS DISTINCT FROM 'male';  -- EDMON FERNANDEZ
UPDATE public.registrations SET gender = 'female' WHERE id = '6a1a730b-27c5-46c9-b14a-9dcd9db001f2' AND gender IS DISTINCT FROM 'female';  -- Eliza Mae Gallang
UPDATE public.registrations SET gender = 'female' WHERE id = '2c8b152c-3d07-4e88-af50-13b538bb2ab1' AND gender IS DISTINCT FROM 'female';  -- Eloisa A. Vicencio
UPDATE public.registrations SET gender = 'female' WHERE id = '005c0ea4-9150-4a48-ada4-f479e3874db7' AND gender IS DISTINCT FROM 'female';  -- ELSA T. PLAZA
UPDATE public.registrations SET gender = 'male' WHERE id = '76168c40-57e7-41c6-bb6b-92a6c33444ce' AND gender IS DISTINCT FROM 'male';  -- Emmanuel Iluzada
UPDATE public.registrations SET gender = 'male' WHERE id = 'b55e768d-ace1-487a-bbac-54415aca985e' AND gender IS DISTINCT FROM 'male';  -- Enzho Santino Aquino
UPDATE public.registrations SET gender = 'female' WHERE id = 'af57196c-d29d-4548-a8d4-70b66eda7cbc' AND gender IS DISTINCT FROM 'female';  -- Ferlie Bacani
UPDATE public.registrations SET gender = 'male' WHERE id = '75f07d21-1407-46db-94ba-edc3547aefa4' AND gender IS DISTINCT FROM 'male';  -- Francis Bacani
UPDATE public.registrations SET gender = 'female' WHERE id = 'cb0caa73-2866-4ac8-b542-02ed683587f2' AND gender IS DISTINCT FROM 'female';  -- Fredelyn Flores Subala
UPDATE public.registrations SET gender = 'female' WHERE id = '101a0ffd-a609-41b7-8330-0087dc84bdca' AND gender IS DISTINCT FROM 'female';  -- Gabrielle Jao M. Jarin
UPDATE public.registrations SET gender = 'male' WHERE id = '15c6ddd3-cb61-4a56-a6ce-3e928bb1e956' AND gender IS DISTINCT FROM 'male';  -- Geniel Soriano
UPDATE public.registrations SET gender = 'male' WHERE id = 'bbf2f671-a5e8-4466-91cd-d7166c5fa7af' AND gender IS DISTINCT FROM 'male';  -- Gian Carl Gerales
UPDATE public.registrations SET gender = 'female' WHERE id = 'f14539ab-a899-4c50-9802-89db9c3edc0f' AND gender IS DISTINCT FROM 'female';  -- Graziela Jae Jarin
UPDATE public.registrations SET gender = 'male' WHERE id = '239d8a04-b115-4387-a640-b8716aaf807e' AND gender IS DISTINCT FROM 'male';  -- Hayden E Amot
UPDATE public.registrations SET gender = 'male' WHERE id = 'cbe9c520-79b1-4eca-af26-ab40a239d3c3' AND gender IS DISTINCT FROM 'male';  -- HOSEA RON T. BAUTISTA
UPDATE public.registrations SET gender = 'male' WHERE id = '13e17f64-b422-49b8-b2c6-1740dc2135e1' AND gender IS DISTINCT FROM 'male';  -- Ian Alojipan
UPDATE public.registrations SET gender = 'male' WHERE id = '259fd0f4-a4c3-4531-9db0-52bc24291f20' AND gender IS DISTINCT FROM 'male';  -- Isaiah Joel E. Famy
UPDATE public.registrations SET gender = 'male' WHERE id = '1d25a38f-0e9d-49c6-ae2b-0f3b5084bffb' AND gender IS DISTINCT FROM 'male';  -- Jaime Antonio F. Magadia
UPDATE public.registrations SET gender = 'male' WHERE id = '172b39fb-209c-48b2-b371-efcdf39fc9b9' AND gender IS DISTINCT FROM 'male';  -- James Balor
UPDATE public.registrations SET gender = 'male' WHERE id = '2df9dd63-fd4e-4222-982b-93eea15f1de7' AND gender IS DISTINCT FROM 'male';  -- Jan Daenell Bancud
UPDATE public.registrations SET gender = 'female' WHERE id = 'b1b6fcf7-c27f-48c2-bfa3-da98aa0cff79' AND gender IS DISTINCT FROM 'female';  -- Jan Mari Franchesca Macalinga
UPDATE public.registrations SET gender = 'male' WHERE id = '4b660932-45f1-42cc-88f6-4e00ffb4e5d2' AND gender IS DISTINCT FROM 'male';  -- Jared Yuan Amot Daza
UPDATE public.registrations SET gender = 'male' WHERE id = '8e2c70e4-2c6a-4b7b-b2c7-9cd0e0bc6845' AND gender IS DISTINCT FROM 'male';  -- Jefferson Ignacio
UPDATE public.registrations SET gender = 'male' WHERE id = '575c9558-8ee9-444d-a104-fa0e6ac6a1dd' AND gender IS DISTINCT FROM 'male';  -- Jeffrey Emboc
UPDATE public.registrations SET gender = 'female' WHERE id = '77e780ce-71bb-4755-ac1a-aa272ae0d7ab' AND gender IS DISTINCT FROM 'female';  -- Jenieca Rica M. Emboc
UPDATE public.registrations SET gender = 'female' WHERE id = '0d7ab1f0-e95d-4322-9234-05f75f7bc667' AND gender IS DISTINCT FROM 'female';  -- JENNY CANTONJOS
UPDATE public.registrations SET gender = 'male' WHERE id = '0dbb1061-b2e9-49f1-b6e5-c76e0147fed7' AND gender IS DISTINCT FROM 'male';  -- Jeo B. Yparraguirre
UPDATE public.registrations SET gender = 'male' WHERE id = 'd73c94fb-b613-4f0c-baa5-fb6f34f3035a' AND gender IS DISTINCT FROM 'male';  -- Jeorge Xiaro P. Sugian
UPDATE public.registrations SET gender = 'male' WHERE id = 'f48e98ed-39a9-4052-8b1b-ed4f264c349b' AND gender IS DISTINCT FROM 'male';  -- Jerald Anghag
UPDATE public.registrations SET gender = 'male' WHERE id = '64269fdc-ca18-45f6-9c66-4ba36dfd0ac9' AND gender IS DISTINCT FROM 'male';  -- Jeremy Patrick Jo
UPDATE public.registrations SET gender = 'male' WHERE id = '397e72f0-1ceb-4034-8143-f27bfc36adba' AND gender IS DISTINCT FROM 'male';  -- Jerick Raja D. Mindoro
UPDATE public.registrations SET gender = 'female' WHERE id = 'a67571b1-f2ae-41c2-ae54-aa31cac39677' AND gender IS DISTINCT FROM 'female';  -- Jessen A. Yparraguirre
UPDATE public.registrations SET gender = 'male' WHERE id = '91837437-de48-446c-8851-a9220e445dd1' AND gender IS DISTINCT FROM 'male';  -- Jj Cris Quinones
UPDATE public.registrations SET gender = 'female' WHERE id = 'd01510b4-4c16-4424-9139-7190233428b4' AND gender IS DISTINCT FROM 'female';  -- Joan Ignacio
UPDATE public.registrations SET gender = 'male' WHERE id = 'a58eaccd-0972-4dd3-8e2a-4b912795f4ec' AND gender IS DISTINCT FROM 'male';  -- Jofet Victor Paredes
UPDATE public.registrations SET gender = 'male' WHERE id = 'cd281afd-4e3d-4f05-9ae4-04f38585a121' AND gender IS DISTINCT FROM 'male';  -- Johnley M. Batilo
UPDATE public.registrations SET gender = 'female' WHERE id = '61f21b72-6b4a-49b5-9726-764b86e80e36' AND gender IS DISTINCT FROM 'female';  -- Johnzen Kaye Taasan
UPDATE public.registrations SET gender = 'female' WHERE id = '343c5fa3-c4a5-491b-a641-17f54f133629' AND gender IS DISTINCT FROM 'female';  -- Joliann A. Sandag
UPDATE public.registrations SET gender = 'female' WHERE id = '1a910aee-a411-4aff-a235-bfb82a7f62fb' AND gender IS DISTINCT FROM 'female';  -- Jonah Balor
UPDATE public.registrations SET gender = 'male' WHERE id = '80356551-c720-442b-8d50-2095fa5333de' AND gender IS DISTINCT FROM 'male';  -- JT Pascual
UPDATE public.registrations SET gender = 'female' WHERE id = '25bd0cf5-a8b4-4523-8491-a3b1659b9745' AND gender IS DISTINCT FROM 'female';  -- Kathlyn Pacad
UPDATE public.registrations SET gender = 'male' WHERE id = 'bfb54129-14bd-418d-b836-df1ed908e6dc' AND gender IS DISTINCT FROM 'male';  -- Kriston Alfred Pansacola
UPDATE public.registrations SET gender = 'female' WHERE id = '184dfee7-4603-44ce-8d9e-634592dc293d' AND gender IS DISTINCT FROM 'female';  -- Lois Rubia Mondejar
UPDATE public.registrations SET gender = 'female' WHERE id = 'ecd5c735-8530-4d11-8559-bd4056274ff4' AND gender IS DISTINCT FROM 'female';  -- LYCA M. TAWIDE
UPDATE public.registrations SET gender = 'male' WHERE id = 'b7a849fa-a939-47a5-8cf8-f3221f1ebc57' AND gender IS DISTINCT FROM 'male';  -- Manz candelario borbon
UPDATE public.registrations SET gender = 'female' WHERE id = 'c330dc7d-243e-40dc-b940-79dac86b227f' AND gender IS DISTINCT FROM 'female';  -- Margie Quinones
UPDATE public.registrations SET gender = 'female' WHERE id = 'e9a91876-d342-47df-bdcc-87f95f0d4036' AND gender IS DISTINCT FROM 'female';  -- Maridel Tuazon
UPDATE public.registrations SET gender = 'male' WHERE id = '43e59f66-9e06-4c5e-9243-1b66efa01182' AND gender IS DISTINCT FROM 'male';  -- Mark Razel Martinez
UPDATE public.registrations SET gender = 'female' WHERE id = '05da8d82-c6c1-4cd9-bbda-ffdde58a0a02' AND gender IS DISTINCT FROM 'female';  -- MEEKY GLYN T. BAUTISTA
UPDATE public.registrations SET gender = 'female' WHERE id = '78762bb6-f32e-454b-a031-a665fd4098e3' AND gender IS DISTINCT FROM 'female';  -- Monique Gonzales
UPDATE public.registrations SET gender = 'female' WHERE id = '346433e2-7bb1-4bd8-a990-858e89bf0130' AND gender IS DISTINCT FROM 'female';  -- PATRICIA JOY YANSON BELLEZA
UPDATE public.registrations SET gender = 'female' WHERE id = '246ac0c0-5cf0-4adf-986d-c9ac984d1e01' AND gender IS DISTINCT FROM 'female';  -- Princess Joy Nodado
UPDATE public.registrations SET gender = 'male' WHERE id = 'b5352096-43f0-4bc9-a0d2-237c90467025' AND gender IS DISTINCT FROM 'male';  -- Reynaldo Jr. Bañares
UPDATE public.registrations SET gender = 'female' WHERE id = '0b2d542e-b4e9-472d-b177-0155b24e4fc5' AND gender IS DISTINCT FROM 'female';  -- Reynalyn Medina
UPDATE public.registrations SET gender = 'female' WHERE id = '756996e6-cf4b-47a5-b732-452a0e950871' AND gender IS DISTINCT FROM 'female';  -- Rica Jeneth Vidal-Batilo
UPDATE public.registrations SET gender = 'male' WHERE id = '2dcad5ad-e939-4ab7-b6e4-dff0fe2ca577' AND gender IS DISTINCT FROM 'male';  -- Ryan daging mollanida
UPDATE public.registrations SET gender = 'female' WHERE id = '7edb9a17-c86e-4214-9864-42b1483c7c2f' AND gender IS DISTINCT FROM 'female';  -- Sheila Jessen Yparraguirre
UPDATE public.registrations SET gender = 'female' WHERE id = '43dc02cc-1c33-4b84-a428-d457298ef20a' AND gender IS DISTINCT FROM 'female';  -- Sherlyn mae fatima bancud
UPDATE public.registrations SET gender = 'female' WHERE id = 'e5921809-fc97-403a-9a69-d4f32d978491' AND gender IS DISTINCT FROM 'female';  -- Trisha Marie Bustonera
UPDATE public.registrations SET gender = 'male' WHERE id = '35168366-24ff-484d-957f-2314d2e547bc' AND gender IS DISTINCT FROM 'male';  -- JOSHUA VINCENT G. DIAZ
UPDATE public.registrations SET gender = 'male' WHERE id = '9ebf306b-808b-4e59-9a3f-7e367cbdf883' AND gender IS DISTINCT FROM 'male';  -- Mark Lewis Carillo
UPDATE public.registrations SET gender = 'male' WHERE id = '1857233f-3390-473f-a3c6-217fd08dedf7' AND gender IS DISTINCT FROM 'male';  -- Ronel Cabale
UPDATE public.registrations SET gender = 'female' WHERE id = '7c0976bb-16e7-4859-8394-c2fa5c9c06da' AND gender IS DISTINCT FROM 'female';  -- Bea Jacqueline B. Angeles
UPDATE public.registrations SET gender = 'female' WHERE id = 'b1195dff-2ad1-430a-8ae6-c0755abd6244' AND gender IS DISTINCT FROM 'female';  -- Candisse D. Dacon
UPDATE public.registrations SET gender = 'female' WHERE id = 'f69b5135-deb6-413a-82d8-51279dbc897c' AND gender IS DISTINCT FROM 'female';  -- Danikka M. Tuazon
UPDATE public.registrations SET gender = 'male' WHERE id = '2fef8b28-20fc-4034-853f-1beafbda59a5' AND gender IS DISTINCT FROM 'male';  -- Edmon D. Cantonjos
UPDATE public.registrations SET gender = 'male' WHERE id = 'a68f35f1-6696-40fa-838e-d014147bf4db' AND gender IS DISTINCT FROM 'male';  -- Emmanuel Paquillo
UPDATE public.registrations SET gender = 'male' WHERE id = '0a711311-61d2-4533-85cb-6a48ca2ac308' AND gender IS DISTINCT FROM 'male';  -- Francis Lopez
UPDATE public.registrations SET gender = 'male' WHERE id = 'e3f64602-15cc-439d-af7d-a2b6ed733812' AND gender IS DISTINCT FROM 'male';  -- Gabriel M. Angcog
UPDATE public.registrations SET gender = 'female' WHERE id = '1af420ce-f8a2-42d7-a48d-dde279978bec' AND gender IS DISTINCT FROM 'female';  -- Jessica Abalos Bautista
UPDATE public.registrations SET gender = 'female' WHERE id = 'a28e6bbf-81f8-4d49-bdbd-e32e88787764' AND gender IS DISTINCT FROM 'female';  -- JOAN BONDOC SIASAT
UPDATE public.registrations SET gender = 'male' WHERE id = 'f1f4b607-ccef-4c33-953c-eb7460a27131' AND gender IS DISTINCT FROM 'male';  -- John France Mariano
UPDATE public.registrations SET gender = 'male' WHERE id = '01c00cd1-0e23-461c-93b8-1897c8d49d22' AND gender IS DISTINCT FROM 'male';  -- John Lloyd Bautista
UPDATE public.registrations SET gender = 'male' WHERE id = 'af0b1db5-9017-47cd-9a87-18546aa98ddc' AND gender IS DISTINCT FROM 'male';  -- Kim Pangilinan
UPDATE public.registrations SET gender = 'female' WHERE id = '2429b13f-18ac-4684-8657-5d7145c8fc2d' AND gender IS DISTINCT FROM 'female';  -- Krishannah Chaelyn I. Jaminal
UPDATE public.registrations SET gender = 'female' WHERE id = 'f8850dc7-326f-4e54-b74a-7220b27de3a8' AND gender IS DISTINCT FROM 'female';  -- Lianne Dale Ramos-Monzon
UPDATE public.registrations SET gender = 'female' WHERE id = 'aed5af3f-d493-4d87-adb1-1e19e7be0bdc' AND gender IS DISTINCT FROM 'female';  -- Lyca Lazaga
UPDATE public.registrations SET gender = 'female' WHERE id = '495cfe8d-f333-4ad6-b313-9aff88f7d246' AND gender IS DISTINCT FROM 'female';  -- Maricel G. De Luna
UPDATE public.registrations SET gender = 'male' WHERE id = '4b000558-0e79-4d2b-836c-9863d45eb361' AND gender IS DISTINCT FROM 'male';  -- Mark Pangilinan
UPDATE public.registrations SET gender = 'female' WHERE id = '3b9681f9-a6a2-46d5-abe9-0a2b48488021' AND gender IS DISTINCT FROM 'female';  -- Mary Laine Hingada
UPDATE public.registrations SET gender = 'female' WHERE id = 'cec74763-8d11-4a83-8308-df8af3f5a9f0' AND gender IS DISTINCT FROM 'female';  -- Mary Vince Diocades
UPDATE public.registrations SET gender = 'male' WHERE id = '217c6185-deca-4572-8ec2-725250f814e4' AND gender IS DISTINCT FROM 'male';  -- Nathaniel Gacgacao
UPDATE public.registrations SET gender = 'female' WHERE id = 'd7f1e5ea-f8b2-4aac-a20d-ef0bb398614b' AND gender IS DISTINCT FROM 'female';  -- Patricia Pascua
UPDATE public.registrations SET gender = 'male' WHERE id = '0c742024-17bc-44cb-a81d-295f19fb85c4' AND gender IS DISTINCT FROM 'male';  -- paul edison cabrera
UPDATE public.registrations SET gender = 'male' WHERE id = '0824f4a6-bc64-42a0-8ac4-ed892b4d4a7c' AND gender IS DISTINCT FROM 'male';  -- paul john lozano
UPDATE public.registrations SET gender = 'male' WHERE id = '250e3b38-7ad8-4c1b-bda3-83dc87cd0678' AND gender IS DISTINCT FROM 'male';  -- Paul Sales
UPDATE public.registrations SET gender = 'female' WHERE id = '8c3b5c60-0fa8-4cb1-ab1e-d98cb3ab4c12' AND gender IS DISTINCT FROM 'female';  -- Princess Jean Bintol
UPDATE public.registrations SET gender = 'male' WHERE id = '07c073eb-9bb3-4ec1-a77b-1b51f7774204' AND gender IS DISTINCT FROM 'male';  -- Rex Regalado
UPDATE public.registrations SET gender = 'female' WHERE id = '4c574749-eb1a-491e-9bdc-a5c5ca684cd3' AND gender IS DISTINCT FROM 'female';  -- Ria Mangonon
UPDATE public.registrations SET gender = 'female' WHERE id = '6c7e6c2d-a472-4199-8fe2-ee0cd1236ac0' AND gender IS DISTINCT FROM 'female';  -- Rose Ann Aloguin Bolitres
UPDATE public.registrations SET gender = 'female' WHERE id = 'f91d0e93-e76e-4fa5-829a-6ebf1eafb491' AND gender IS DISTINCT FROM 'female';  -- Rose Castillo
UPDATE public.registrations SET gender = 'female' WHERE id = 'd9605ace-0ceb-4541-a961-350055d1e9d0' AND gender IS DISTINCT FROM 'female';  -- Ruth Joy L. Asendido
UPDATE public.registrations SET gender = 'female' WHERE id = '92b08bbb-cfc5-4f5e-9ad2-7ad365ce9a99' AND gender IS DISTINCT FROM 'female';  -- Vanesa Pagsiat
UPDATE public.registrations SET gender = 'female' WHERE id = 'f8383790-1ea4-40a3-88de-addfe8efd93d' AND gender IS DISTINCT FROM 'female';  -- Veronica Aquino
UPDATE public.registrations SET gender = 'female' WHERE id = 'f95d38c6-cb58-4aab-a6f5-fd809e887307' AND gender IS DISTINCT FROM 'female';  -- Zaira Joy V. Raet
UPDATE public.registrations SET gender = 'female' WHERE id = '968d76c4-44a2-410e-aead-09ee12e9c84d' AND gender IS DISTINCT FROM 'female';  -- Alyssa Vea Pascual
UPDATE public.registrations SET gender = 'male' WHERE id = '03d3a476-a35c-4892-a550-89f8f5a0aff3' AND gender IS DISTINCT FROM 'male';  -- Carl Jasper Monzon
UPDATE public.registrations SET gender = 'male' WHERE id = 'ae944fd1-345f-4ab2-b5fc-1d412576bfa6' AND gender IS DISTINCT FROM 'male';  -- Christian Jhon Caballero Miano
UPDATE public.registrations SET gender = 'female' WHERE id = '153cbe95-c90b-4a18-a1cd-539223e4adcc' AND gender IS DISTINCT FROM 'female';  -- Christine Ferrera
UPDATE public.registrations SET gender = 'male' WHERE id = '0582fe4b-fd63-4329-8813-797c4b45c4e1' AND gender IS DISTINCT FROM 'male';  -- IAN JOHN SANOY ALOJIPAN
UPDATE public.registrations SET gender = 'female' WHERE id = '17205509-7c9b-4514-b738-49bcecb9efbd' AND gender IS DISTINCT FROM 'female';  -- JENNY CANTONJOS
UPDATE public.registrations SET gender = 'female' WHERE id = 'f18b82e8-6169-4b0d-9548-ac0e544931aa' AND gender IS DISTINCT FROM 'female';  -- JENNY CANTONJOS
UPDATE public.registrations SET gender = 'female' WHERE id = '16c79b65-d297-49e9-b184-0401bd8b837f' AND gender IS DISTINCT FROM 'female';  -- JENNY CANTONJOS
UPDATE public.registrations SET gender = 'female' WHERE id = '31044eec-251b-406e-9543-c1ea0010f79e' AND gender IS DISTINCT FROM 'female';  -- JENNY CANTONJOS
UPDATE public.registrations SET gender = 'female' WHERE id = '2041089a-e827-4301-be48-e891303d8bf9' AND gender IS DISTINCT FROM 'female';  -- JENNY CANTONJOS
UPDATE public.registrations SET gender = 'female' WHERE id = '5abf0af9-0163-4dbe-9da0-b1264ebbebb8' AND gender IS DISTINCT FROM 'female';  -- Jenny D. Cantonjos
UPDATE public.registrations SET gender = 'male' WHERE id = '1a869687-bfa2-4616-9309-aa0bfbf00731' AND gender IS DISTINCT FROM 'male';  -- Jerick D. Mindoro
UPDATE public.registrations SET gender = 'male' WHERE id = '16985109-3dba-4e0d-a5eb-10a90574baa9' AND gender IS DISTINCT FROM 'male';  -- Jordan Teodoro Pascual
UPDATE public.registrations SET gender = 'female' WHERE id = '6800d8b2-3d72-4d87-807b-3f10a892cefb' AND gender IS DISTINCT FROM 'female';  -- Reynalyn Medina
UPDATE public.registrations SET gender = 'female' WHERE id = 'cb43f862-04d6-4993-a15a-8e425ab1bf5d' AND gender IS DISTINCT FROM 'female';  -- Rica Jeneth Vidal Batilo
UPDATE public.registrations SET gender = 'male' WHERE id = 'e11d45a7-69fa-4c25-8e45-372caf841df7' AND gender IS DISTINCT FROM 'male';  -- Caleb Dirnberger
UPDATE public.registrations SET gender = 'male' WHERE id = 'f501fb0b-cdee-4d52-9e3e-2295c25027a0' AND gender IS DISTINCT FROM 'male';  -- David Zimmer
UPDATE public.registrations SET gender = 'male' WHERE id = 'f5dea2a1-6d85-4653-9892-7bb306781039' AND gender IS DISTINCT FROM 'male';  -- Gideon John
UPDATE public.registrations SET gender = 'female' WHERE id = '0cf11d4f-419c-43cc-97e7-ddd92c1d9677' AND gender IS DISTINCT FROM 'female';  -- Hannah Rose
UPDATE public.registrations SET gender = 'male' WHERE id = 'e41b451a-ea66-41c6-ae2d-653c35977529' AND gender IS DISTINCT FROM 'male';  -- Jared Mellinger
UPDATE public.registrations SET gender = 'male' WHERE id = 'f390e7c8-12d1-4a9b-a74d-c237c1b3c7d7' AND gender IS DISTINCT FROM 'male';  -- Jun Ha Kang
UPDATE public.registrations SET gender = 'female' WHERE id = 'f28808ab-b92a-4949-b6ef-ef6ddc8de57b' AND gender IS DISTINCT FROM 'female';  -- Lydia Taylor
UPDATE public.registrations SET gender = 'female' WHERE id = 'f462b260-8d93-403b-aaca-792887da8dea' AND gender IS DISTINCT FROM 'female';  -- Mary Elizabeth
UPDATE public.registrations SET gender = 'male' WHERE id = '83b980d2-184d-406b-b56c-e4eea4c4ffd2' AND gender IS DISTINCT FROM 'male';  -- Matthew Neale
UPDATE public.registrations SET gender = 'female' WHERE id = '5b2fabaf-668d-4eb4-876f-9b52833c4623' AND gender IS DISTINCT FROM 'female';  -- Rachel Hansen

COMMIT;

-- Check afterwards:
--   SELECT gender, count(*) FROM public.registrations
--   WHERE registrant_type IS DISTINCT FROM 'international' GROUP BY gender;
