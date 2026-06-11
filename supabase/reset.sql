-- =============================================================================
-- RESET COMPLETO DO BANCO DE DADOS
-- =============================================================================
-- ⚠️ ATENÇÃO: Este script APAGA TODOS OS DADOS do banco!
-- ⚠️ Não pode ser desfeito! Use apenas em desenvolvimento/staging.
--
-- Executa deleções em ordem reversa de dependências para evitar erros de FK.
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '🔥 INICIANDO RESET COMPLETO DO BANCO DE DADOS...';
    RAISE NOTICE '';
    
    -- ==========================================================================
    -- 1. DADOS DE APLICAÇÃO (ordem reversa de dependências)
    -- ==========================================================================
    
    RAISE NOTICE '📊 Deletando dados de aplicação...';

    -- Appointments (cache de agenda — dependem de contacts e professionals; deletar ANTES deles)
    DELETE FROM appointments;
    RAISE NOTICE '   ✓ appointments deletados';

    -- Deal items (dependem de deals e products)
    DELETE FROM deal_items;
    RAISE NOTICE '   ✓ deal_items deletados';
    
    -- Atendimentos (dependem de deals, contacts, professionals, products)
    DELETE FROM atendimentos;
    RAISE NOTICE '   ✓ atendimentos deletados';

    -- Activities (dependem de deals e contacts)
    DELETE FROM activities;
    RAISE NOTICE '   ✓ activities deletadas';
    
    -- Deals (dependem de contacts, boards, stages)
    DELETE FROM deals;
    RAISE NOTICE '   ✓ deals deletados';
    
    -- Contacts (dependem de companies)
    DELETE FROM contacts;
    RAISE NOTICE '   ✓ contacts deletados';
    
    -- CRM Companies
    DELETE FROM crm_companies;
    RAISE NOTICE '   ✓ crm_companies deletadas';
    
    -- Configs financeiras (commission_rules/commission_payments referenciam
    -- professionals — deletar ANTES de professionals)
    DELETE FROM commission_payments;
    RAISE NOTICE '   ✓ commission_payments deletados';

    DELETE FROM commission_rules;
    RAISE NOTICE '   ✓ commission_rules deletadas';

    DELETE FROM payment_method_fees;
    RAISE NOTICE '   ✓ payment_method_fees deletadas';

    DELETE FROM fixed_costs;
    RAISE NOTICE '   ✓ fixed_costs deletados';

    -- Professionals (camada clínico-financeira)
    DELETE FROM professionals;
    RAISE NOTICE '   ✓ professionals deletados';

    -- Clinicorp config (integração por tenant — token server-side)
    DELETE FROM clinicorp_config;
    RAISE NOTICE '   ✓ clinicorp_config deletados';

    -- Products
    DELETE FROM products;
    RAISE NOTICE '   ✓ products deletados';
    
    -- Leads
    DELETE FROM leads;
    RAISE NOTICE '   ✓ leads deletados';
    
    -- Tags
    DELETE FROM tags;
    RAISE NOTICE '   ✓ tags deletadas';
    
    -- Custom field definitions
    DELETE FROM custom_field_definitions;
    RAISE NOTICE '   ✓ custom_field_definitions deletadas';
    
    -- ==========================================================================
    -- Webhooks/Integrações (podem referenciar board_stages/boards)
    -- ==========================================================================

    -- Outbound deliveries/events (podem depender de deals/stages)
    DELETE FROM webhook_deliveries;
    RAISE NOTICE '   ✓ webhook_deliveries deletadas';

    DELETE FROM webhook_events_out;
    RAISE NOTICE '   ✓ webhook_events_out deletadas';

    -- Inbound events/sources (source referencia board_stages)
    DELETE FROM webhook_events_in;
    RAISE NOTICE '   ✓ webhook_events_in deletadas';

    DELETE FROM integration_outbound_endpoints;
    RAISE NOTICE '   ✓ integration_outbound_endpoints deletados';

    DELETE FROM integration_inbound_sources;
    RAISE NOTICE '   ✓ integration_inbound_sources deletadas';

    -- Board stages (dependem de boards)
    DELETE FROM board_stages;
    RAISE NOTICE '   ✓ board_stages deletadas';
    
    -- Boards
    DELETE FROM boards;
    RAISE NOTICE '   ✓ boards deletados';
    
    -- ==========================================================================
    -- 2. DADOS DE IA E LOGS
    -- ==========================================================================
    
    RAISE NOTICE '';
    RAISE NOTICE '🤖 Deletando dados de IA...';
    
    -- AI Conversations
    DELETE FROM ai_conversations;
    RAISE NOTICE '   ✓ ai_conversations deletadas';
    
    -- AI Audio Notes
    DELETE FROM ai_audio_notes;
    RAISE NOTICE '   ✓ ai_audio_notes deletadas';
    
    -- AI Suggestion Interactions
    DELETE FROM ai_suggestion_interactions;
    RAISE NOTICE '   ✓ ai_suggestion_interactions deletadas';
    
    -- System Notifications
    DELETE FROM system_notifications;
    RAISE NOTICE '   ✓ system_notifications deletadas';
    
    -- ==========================================================================
    -- 3. CONFIGURAÇÕES DE USUÁRIOS
    -- ==========================================================================
    
    RAISE NOTICE '';
    RAISE NOTICE '⚙️ Deletando configurações...';
    
    -- Profile Permissions (dependem de profiles e organizations) — deletar antes de profiles
    DELETE FROM profile_permissions;
    RAISE NOTICE '   ✓ profile_permissions deletadas';

    -- User Settings
    DELETE FROM user_settings;
    RAISE NOTICE '   ✓ user_settings deletadas';
    
    -- ==========================================================================
    -- 4. USUÁRIOS E ORGANIZAÇÕES (CASCATA)
    -- ==========================================================================
    
    RAISE NOTICE '';
    RAISE NOTICE '👥 Deletando usuários e organizações...';
    
    -- Profiles (CASCADE vai deletar muita coisa vinculada)
    DELETE FROM profiles;
    RAISE NOTICE '   ✓ profiles deletados';
    
    -- Organizations (CASCADE vai deletar tudo vinculado a elas)
    DELETE FROM organizations;
    RAISE NOTICE '   ✓ organizations deletadas';
    
    -- ==========================================================================
    -- 5. AUTH (SUPABASE AUTH USERS)
    -- ==========================================================================
    
    RAISE NOTICE '';
    RAISE NOTICE '🔐 Deletando usuários de autenticação...';
    
    -- Delete users from auth.users (Supabase Auth)
    DELETE FROM auth.users;
    RAISE NOTICE '   ✓ auth.users deletados';
    
    -- ==========================================================================
    -- FINALIZAÇÃO
    -- ==========================================================================
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ RESET COMPLETO FINALIZADO!';
    RAISE NOTICE '';
    RAISE NOTICE '📝 Próximo passo: Execute o seed.sql para popular o banco novamente.';
    RAISE NOTICE '';
    
END $$;
