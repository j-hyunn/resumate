
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "achievements": {
                  Row: {
                    "created_at": string,"description": string | null,"experience_id": string | null,"id": string,"kind": string | null,"metric_name": string | null,"project_detail_id": string | null,"source_writing_chat_id": string | null,"status": string,"unit": string | null,"updated_at": string,"user_id": string,"value_after": number | null,"value_before": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"experience_id"?: string | null,"id"?: string,"kind"?: never,"metric_name"?: string | null,"project_detail_id"?: string | null,"source_writing_chat_id"?: string | null,"status"?: string,"unit"?: string | null,"updated_at"?: string,"user_id"?: string,"value_after"?: number | null,"value_before"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"experience_id"?: string | null,"id"?: string,"kind"?: never,"metric_name"?: string | null,"project_detail_id"?: string | null,"source_writing_chat_id"?: string | null,"status"?: string,"unit"?: string | null,"updated_at"?: string,"user_id"?: string,"value_after"?: number | null,"value_before"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "achievements_experience_fkey"
      columns: ["experience_id","user_id"]
isOneToOne: false
      referencedRelation: "experiences"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "achievements_project_detail_fkey"
      columns: ["project_detail_id","user_id"]
isOneToOne: false
      referencedRelation: "project_details"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "achievements_source_writing_chat_fkey"
      columns: ["source_writing_chat_id","user_id"]
isOneToOne: false
      referencedRelation: "writing_chats"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"ai_data_use_consents": {
                  Row: {
                    "agreed_at": string,"connection_tier": string,"created_at": string,"disclosure_version": string,"free_tier_acknowledged": boolean,"id": string,"provider": string,"user_id": string,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agreed_at"?: string,"connection_tier": string,"created_at"?: string,"disclosure_version": string,"free_tier_acknowledged"?: boolean,"id"?: string,"provider": string,"user_id"?: string,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "agreed_at"?: string,"connection_tier"?: string,"created_at"?: string,"disclosure_version"?: string,"free_tier_acknowledged"?: boolean,"id"?: string,"provider"?: string,"user_id"?: string,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"ai_disclosures": {
                  Row: {
                    "connection_tier": string,"created_at": string,"document_path": string,"effective_at": string,"id": string,"provider": string,"requires_free_tier_ack": boolean,"requires_reconsent": boolean,"terms_checked_at": string | null,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_tier": string,"created_at"?: string,"document_path": string,"effective_at": string,"id"?: string,"provider": string,"requires_free_tier_ack"?: boolean,"requires_reconsent"?: boolean,"terms_checked_at"?: string | null,"version": string
                  }
                  Update: {
                    "connection_tier"?: string,"created_at"?: string,"document_path"?: string,"effective_at"?: string,"id"?: string,"provider"?: string,"requires_free_tier_ack"?: boolean,"requires_reconsent"?: boolean,"terms_checked_at"?: string | null,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_jobs": {
                  Row: {
                    "application_project_id": string | null,"cancel_requested_at": string | null,"connection_tier": string,"created_at": string,"error_category": string | null,"error_code": string | null,"failure_cause": string | null,"finished_at": string | null,"heartbeat_at": string | null,"id": string,"input_hash": string | null,"job_type": string,"model": string | null,"model_tier": string,"next_run_at": string | null,"output": Json | null,"params": NonNullable<Json>,"progress": Json | null,"prompt_version": string | null,"provider": string,"quota_resets_at": string | null,"retry_after": string | null,"retry_count": number,"retry_wait_total_ms": number,"run_generation": number,"started_at": string | null,"status": string,"step_outputs": NonNullable<Json>,"target_id": string | null,"target_type": string | null,"updated_at": string,"usage": Json | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id"?: string | null,"cancel_requested_at"?: string | null,"connection_tier": string,"created_at"?: string,"error_category"?: never,"error_code"?: string | null,"failure_cause"?: never,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input_hash"?: string | null,"job_type": string,"model"?: string | null,"model_tier": string,"next_run_at"?: string | null,"output"?: Json | null,"params"?: NonNullable<Json>,"progress"?: Json | null,"prompt_version"?: string | null,"provider": string,"quota_resets_at"?: string | null,"retry_after"?: string | null,"retry_count"?: number,"retry_wait_total_ms"?: number,"run_generation"?: number,"started_at"?: string | null,"status"?: string,"step_outputs"?: NonNullable<Json>,"target_id"?: string | null,"target_type"?: string | null,"updated_at"?: string,"usage"?: Json | null,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string | null,"cancel_requested_at"?: string | null,"connection_tier"?: string,"created_at"?: string,"error_category"?: never,"error_code"?: string | null,"failure_cause"?: never,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input_hash"?: string | null,"job_type"?: string,"model"?: string | null,"model_tier"?: string,"next_run_at"?: string | null,"output"?: Json | null,"params"?: NonNullable<Json>,"progress"?: Json | null,"prompt_version"?: string | null,"provider"?: string,"quota_resets_at"?: string | null,"retry_after"?: string | null,"retry_count"?: number,"retry_wait_total_ms"?: number,"run_generation"?: number,"started_at"?: string | null,"status"?: string,"step_outputs"?: NonNullable<Json>,"target_id"?: string | null,"target_type"?: string | null,"updated_at"?: string,"usage"?: Json | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_price_tables": {
                  Row: {
                    "cache_write_usd_per_mtok": number | null,"cached_input_usd_per_mtok": number | null,"created_at": string,"effective_from": string,"id": string,"input_usd_per_mtok": number,"long_context_cache_write_usd_per_mtok": number | null,"long_context_cached_input_usd_per_mtok": number | null,"long_context_input_usd_per_mtok": number | null,"long_context_output_usd_per_mtok": number | null,"long_context_threshold_tokens": number | null,"model": string,"output_usd_per_mtok": number,"provider": string,"source_checked_at": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_write_usd_per_mtok"?: number | null,"cached_input_usd_per_mtok"?: number | null,"created_at"?: string,"effective_from": string,"id"?: string,"input_usd_per_mtok": number,"long_context_cache_write_usd_per_mtok"?: number | null,"long_context_cached_input_usd_per_mtok"?: number | null,"long_context_input_usd_per_mtok"?: number | null,"long_context_output_usd_per_mtok"?: number | null,"long_context_threshold_tokens"?: number | null,"model": string,"output_usd_per_mtok": number,"provider": string,"source_checked_at": string,"version": string
                  }
                  Update: {
                    "cache_write_usd_per_mtok"?: number | null,"cached_input_usd_per_mtok"?: number | null,"created_at"?: string,"effective_from"?: string,"id"?: string,"input_usd_per_mtok"?: number,"long_context_cache_write_usd_per_mtok"?: number | null,"long_context_cached_input_usd_per_mtok"?: number | null,"long_context_input_usd_per_mtok"?: number | null,"long_context_output_usd_per_mtok"?: number | null,"long_context_threshold_tokens"?: number | null,"model"?: string,"output_usd_per_mtok"?: number,"provider"?: string,"source_checked_at"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_provider_keys": {
                  Row: {
                    "connection_tier": string,"created_at": string,"encryption_version": number,"id": string,"kek_id": string,"key_ciphertext": string,"key_last4": string,"key_nonce": string,"last_failure_at": string | null,"last_failure_cause": string | null,"last_verified_at": string | null,"provider": string,"status": string,"updated_at": string,"user_id": string,"wrapped_dek": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_tier": string,"created_at"?: string,"encryption_version"?: number,"id": string,"kek_id": string,"key_ciphertext": string,"key_last4": string,"key_nonce": string,"last_failure_at"?: string | null,"last_failure_cause"?: string | null,"last_verified_at"?: string | null,"provider": string,"status": string,"updated_at"?: string,"user_id"?: string,"wrapped_dek": string
                  }
                  Update: {
                    "connection_tier"?: string,"created_at"?: string,"encryption_version"?: number,"id"?: string,"kek_id"?: string,"key_ciphertext"?: string,"key_last4"?: string,"key_nonce"?: string,"last_failure_at"?: string | null,"last_failure_cause"?: string | null,"last_verified_at"?: string | null,"provider"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string,"wrapped_dek"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_providers": {
                  Row: {
                    "billing_url": string | null,"created_at": string,"dashboard_url": string | null,"display_order": number,"is_available": boolean,"is_recommended": boolean,"key_guide_checked_at": string | null,"key_guide_version": string | null,"provider": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_url"?: string | null,"created_at"?: string,"dashboard_url"?: string | null,"display_order": number,"is_available"?: boolean,"is_recommended"?: boolean,"key_guide_checked_at"?: string | null,"key_guide_version"?: string | null,"provider": string,"updated_at"?: string
                  }
                  Update: {
                    "billing_url"?: string | null,"created_at"?: string,"dashboard_url"?: string | null,"display_order"?: number,"is_available"?: boolean,"is_recommended"?: boolean,"key_guide_checked_at"?: string | null,"key_guide_version"?: string | null,"provider"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_usage_records": {
                  Row: {
                    "ai_job_id": string | null,"application_project_id": string | null,"cache_write_tokens": number,"cached_input_tokens": number,"call_key": string | null,"connection_tier": string,"created_at": string,"error_code": string | null,"estimated_cost_usd": number,"feature": string,"id": string,"input_tokens": number,"job_type": string,"model": string,"model_tier": string,"occurred_at": string,"outcome": string,"output_tokens": number,"period_month": string,"price_table_version": string,"provider": string,"reasoning_tokens": number | null,"usage_source": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_job_id"?: string | null,"application_project_id"?: string | null,"cache_write_tokens"?: number,"cached_input_tokens"?: number,"call_key"?: string | null,"connection_tier": string,"created_at"?: string,"error_code"?: string | null,"estimated_cost_usd": number,"feature": string,"id"?: string,"input_tokens"?: number,"job_type": string,"model": string,"model_tier": string,"occurred_at"?: string,"outcome": string,"output_tokens"?: number,"period_month"?: string,"price_table_version": string,"provider": string,"reasoning_tokens"?: number | null,"usage_source": string,"user_id"?: string
                  }
                  Update: {
                    "ai_job_id"?: string | null,"application_project_id"?: string | null,"cache_write_tokens"?: number,"cached_input_tokens"?: number,"call_key"?: string | null,"connection_tier"?: string,"created_at"?: string,"error_code"?: string | null,"estimated_cost_usd"?: number,"feature"?: string,"id"?: string,"input_tokens"?: number,"job_type"?: string,"model"?: string,"model_tier"?: string,"occurred_at"?: string,"outcome"?: string,"output_tokens"?: number,"period_month"?: string,"price_table_version"?: string,"provider"?: string,"reasoning_tokens"?: number | null,"usage_source"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"consents": {
                  Row: {
                    "agreed": boolean,"agreed_at": string,"consent_type": string,"created_at": string,"id": string,"policy_version": string,"user_agent_hash": string | null,"user_id": string,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agreed": boolean,"agreed_at"?: string,"consent_type": string,"created_at"?: string,"id"?: string,"policy_version": string,"user_agent_hash"?: string | null,"user_id"?: string,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "agreed"?: boolean,"agreed_at"?: string,"consent_type"?: string,"created_at"?: string,"id"?: string,"policy_version"?: string,"user_agent_hash"?: string | null,"user_id"?: string,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"educations": {
                  Row: {
                    "created_at": string,"description": string | null,"education_type": string | null,"end_month": string | null,"enrollment_status": string | null,"id": string,"institution_name": string | null,"program_name": string | null,"start_month": string | null,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"education_type"?: string | null,"end_month"?: string | null,"enrollment_status"?: string | null,"id"?: string,"institution_name"?: string | null,"program_name"?: string | null,"start_month"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"education_type"?: string | null,"end_month"?: string | null,"enrollment_status"?: string | null,"id"?: string,"institution_name"?: string | null,"program_name"?: string | null,"start_month"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"evidence_links": {
                  Row: {
                    "application_project_id": string,"created_at": string,"id": string,"item_key": string,"owner_id": string,"owner_type": string,"quote": string | null,"quote_adjusted": boolean,"sort_order": number,"source_deleted_at": string | null,"source_field": string | null,"source_id": string,"source_label": string | null,"source_locator": Json | null,"source_snapshot_at": string | null,"source_type": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id": string,"created_at"?: string,"id"?: string,"item_key": string,"owner_id": string,"owner_type": string,"quote"?: string | null,"quote_adjusted"?: boolean,"sort_order"?: number,"source_deleted_at"?: string | null,"source_field"?: string | null,"source_id": string,"source_label"?: string | null,"source_locator"?: Json | null,"source_snapshot_at"?: string | null,"source_type": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string,"created_at"?: string,"id"?: string,"item_key"?: string,"owner_id"?: string,"owner_type"?: string,"quote"?: string | null,"quote_adjusted"?: boolean,"sort_order"?: number,"source_deleted_at"?: string | null,"source_field"?: string | null,"source_id"?: string,"source_label"?: string | null,"source_locator"?: Json | null,"source_snapshot_at"?: string | null,"source_type"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"experiences": {
                  Row: {
                    "company_name": string | null,"created_at": string,"department": string | null,"employment_type": string | null,"end_month": string | null,"id": string,"is_current": boolean,"job_position": string | null,"job_rank": string | null,"start_month": string | null,"status": string,"summary": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_name"?: string | null,"created_at"?: string,"department"?: string | null,"employment_type"?: string | null,"end_month"?: string | null,"id"?: string,"is_current"?: boolean,"job_position"?: string | null,"job_rank"?: string | null,"start_month"?: string | null,"status"?: string,"summary"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "company_name"?: string | null,"created_at"?: string,"department"?: string | null,"employment_type"?: string | null,"end_month"?: string | null,"id"?: string,"is_current"?: boolean,"job_position"?: string | null,"job_rank"?: string | null,"start_month"?: string | null,"status"?: string,"summary"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"policy_versions": {
                  Row: {
                    "created_at": string,"document_path": string,"effective_at": string,"id": string,"policy_type": string,"requires_reconsent": boolean,"updated_at": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"document_path": string,"effective_at": string,"id"?: string,"policy_type": string,"requires_reconsent"?: boolean,"updated_at"?: string,"version": string
                  }
                  Update: {
                    "created_at"?: string,"document_path"?: string,"effective_at"?: string,"id"?: string,"policy_type"?: string,"requires_reconsent"?: boolean,"updated_at"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "active_ai_provider": string | null,"career_data_updated_at": string | null,"created_at": string,"desired_job_title": string | null,"display_name": string | null,"id": string,"inactivity_notice_sent_at": string | null,"interested_industries": (string)[],"last_active_at": string | null,"total_years_of_experience": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_ai_provider"?: string | null,"career_data_updated_at"?: string | null,"created_at"?: string,"desired_job_title"?: string | null,"display_name"?: string | null,"id": string,"inactivity_notice_sent_at"?: string | null,"interested_industries"?: (string)[],"last_active_at"?: string | null,"total_years_of_experience"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "active_ai_provider"?: string | null,"career_data_updated_at"?: string | null,"created_at"?: string,"desired_job_title"?: string | null,"display_name"?: string | null,"id"?: string,"inactivity_notice_sent_at"?: string | null,"interested_industries"?: (string)[],"last_active_at"?: string | null,"total_years_of_experience"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_active_ai_provider_fkey"
      columns: ["id","active_ai_provider"]
isOneToOne: false
      referencedRelation: "ai_provider_keys"
      referencedColumns: ["user_id","provider"]
    }
                  ]
                },"project_details": {
                  Row: {
                    "action": string | null,"created_at": string,"id": string,"learnings": string | null,"project_id": string,"result": string | null,"situation": string | null,"sort_order": number,"source_writing_chat_id": string | null,"status": string,"task": string | null,"title": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action"?: string | null,"created_at"?: string,"id"?: string,"learnings"?: string | null,"project_id": string,"result"?: string | null,"situation"?: string | null,"sort_order": number,"source_writing_chat_id"?: string | null,"status"?: string,"task"?: string | null,"title"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "action"?: string | null,"created_at"?: string,"id"?: string,"learnings"?: string | null,"project_id"?: string,"result"?: string | null,"situation"?: string | null,"sort_order"?: number,"source_writing_chat_id"?: string | null,"status"?: string,"task"?: string | null,"title"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_details_project_fkey"
      columns: ["project_id","user_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "project_details_source_writing_chat_fkey"
      columns: ["source_writing_chat_id","user_id"]
isOneToOne: false
      referencedRelation: "writing_chats"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"project_skills": {
                  Row: {
                    "created_at": string,"project_id": string,"skill_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"project_id": string,"skill_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"project_id"?: string,"skill_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_skills_project_fkey"
      columns: ["project_id","user_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "project_skills_skill_fkey"
      columns: ["skill_id","user_id"]
isOneToOne: false
      referencedRelation: "skills"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "created_at": string,"education_id": string | null,"end_month": string | null,"experience_id": string | null,"id": string,"name": string | null,"role": string | null,"source_writing_chat_id": string | null,"start_month": string | null,"status": string,"summary": string | null,"team_size": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"education_id"?: string | null,"end_month"?: string | null,"experience_id"?: string | null,"id"?: string,"name"?: string | null,"role"?: string | null,"source_writing_chat_id"?: string | null,"start_month"?: string | null,"status"?: string,"summary"?: string | null,"team_size"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"education_id"?: string | null,"end_month"?: string | null,"experience_id"?: string | null,"id"?: string,"name"?: string | null,"role"?: string | null,"source_writing_chat_id"?: string | null,"start_month"?: string | null,"status"?: string,"summary"?: string | null,"team_size"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_education_fkey"
      columns: ["education_id","user_id"]
isOneToOne: false
      referencedRelation: "educations"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "projects_experience_fkey"
      columns: ["experience_id","user_id"]
isOneToOne: false
      referencedRelation: "experiences"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "projects_source_writing_chat_fkey"
      columns: ["source_writing_chat_id","user_id"]
isOneToOne: false
      referencedRelation: "writing_chats"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"skills": {
                  Row: {
                    "created_at": string,"id": string,"is_manual": boolean,"name": string,"normalized_name": string | null,"proficiency": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_manual"?: boolean,"name": string,"normalized_name"?: never,"proficiency"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_manual"?: boolean,"name"?: string,"normalized_name"?: never,"proficiency"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"writing_chat_messages": {
                  Row: {
                    "ai_job_id": string | null,"connection_tier": string | null,"content": string,"created_at": string,"id": string,"model": string | null,"model_tier": string | null,"provider": string | null,"role": string,"sequence": number,"status": string,"updated_at": string,"user_id": string,"writing_chat_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_job_id"?: string | null,"connection_tier"?: string | null,"content": string,"created_at"?: string,"id"?: string,"model"?: string | null,"model_tier"?: string | null,"provider"?: string | null,"role": string,"sequence": number,"status"?: string,"updated_at"?: string,"user_id"?: string,"writing_chat_id": string
                  }
                  Update: {
                    "ai_job_id"?: string | null,"connection_tier"?: string | null,"content"?: string,"created_at"?: string,"id"?: string,"model"?: string | null,"model_tier"?: string | null,"provider"?: string | null,"role"?: string,"sequence"?: number,"status"?: string,"updated_at"?: string,"user_id"?: string,"writing_chat_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "writing_chat_messages_writing_chat_fkey"
      columns: ["writing_chat_id","user_id"]
isOneToOne: false
      referencedRelation: "writing_chats"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"writing_chats": {
                  Row: {
                    "created_at": string,"education_id": string | null,"experience_id": string | null,"id": string,"last_activity_at": string,"last_extracted_sequence": number,"message_count": number,"mode": string,"project_id": string | null,"return_target": Json | null,"saved_at": string | null,"status": string,"structured_draft": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"education_id"?: string | null,"experience_id"?: string | null,"id"?: string,"last_activity_at"?: string,"last_extracted_sequence"?: number,"message_count"?: number,"mode": string,"project_id"?: string | null,"return_target"?: Json | null,"saved_at"?: string | null,"status"?: string,"structured_draft"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"education_id"?: string | null,"experience_id"?: string | null,"id"?: string,"last_activity_at"?: string,"last_extracted_sequence"?: number,"message_count"?: number,"mode"?: string,"project_id"?: string | null,"return_target"?: Json | null,"saved_at"?: string | null,"status"?: string,"structured_draft"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "writing_chats_education_fkey"
      columns: ["education_id","user_id"]
isOneToOne: false
      referencedRelation: "educations"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "writing_chats_experience_fkey"
      columns: ["experience_id","user_id"]
isOneToOne: false
      referencedRelation: "experiences"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "writing_chats_project_fkey"
      columns: ["project_id","user_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id","user_id"]
    }
                  ]
                }
          }
          Views: {
            "ai_provider_keys_public": {
                  Row: {
                    "connection_tier": string,"created_at": string,"id": string,"key_last4": string,"last_failure_at": string | null,"last_failure_cause": string | null,"last_verified_at": string | null,"provider": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                           "connection_tier"?: string | null,"created_at"?: string | null,"id"?: string | null,"key_last4"?: string | null,"last_failure_at"?: string | null,"last_failure_cause"?: string | null,"last_verified_at"?: string | null,"provider"?: string | null,"status"?: string | null,"updated_at"?: string | null
                         }
                        Update: {
                           "connection_tier"?: string | null,"created_at"?: string | null,"id"?: string | null,"key_last4"?: string | null,"last_failure_at"?: string | null,"last_failure_cause"?: string | null,"last_verified_at"?: string | null,"provider"?: string | null,"status"?: string | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "append_writing_chat_message":
{ Args: { "p_content": string,"p_writing_chat_id": string }; Returns: {
              "message_count": number,"message_id": string,"sequence": number
            }[]
                           },
"apply_structured_draft_patch":
{ Args: { "p_patch": Json,"p_writing_chat_id": string }; Returns: Json
                           },
"begin_assistant_message":
{ Args: { "p_ai_job_id": string,"p_connection_tier": string,"p_model": string,"p_model_tier": string,"p_provider": string,"p_writing_chat_id": string }; Returns: {
              "is_final": boolean,"message_count": number,"message_id": string,"reused": boolean,"sequence": number
            }[]
                           },
"check_ai_run_allowed":
{ Args: { "p_ai_job_id": string }; Returns: string
                           },
"claim_due_ai_jobs":
{ Args: { "p_limit": number,"p_now": string }; Returns: {
              "id": string,"user_id": string
            }[]
                           },
"complete_ai_job":
{ Args: { "p_job_id": string,"p_progress"?: Json,"p_run_generation": number }; Returns: undefined
                           },
"delete_career_item":
{ Args: { "p_affiliation_mode"?: string,"p_entity_id": string,"p_entity_type": string,"p_result_mode"?: string }; Returns: Json
                           },
"delete_provider_key":
{ Args: { "p_provider": string }; Returns: boolean
                           },
"finish_assistant_message":
{ Args: { "p_content": string,"p_message_id": string,"p_status": string }; Returns: undefined
                           },
"get_ai_usage_summary":
{ Args: { "p_include_previous"?: boolean,"p_period_month"?: string }; Returns: Json
                           },
"get_consent_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "agreed_version": string,"consent_type": string,"current_version": string,"needs_consent": boolean,"required": boolean
            }[]
                           },
"get_data_readiness":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_deletion_impact":
{ Args: { "p_affiliation_mode"?: string,"p_entity_id": string,"p_entity_type": string }; Returns: Json
                           },
"get_provider_key_secret":
{ Args: { "p_ai_job_id": string }; Returns: {
              "encryption_version": number,"kek_id": string,"key_ciphertext": string,"key_id": string,"key_nonce": string,"wrapped_dek": string
            }[]
                           },
"hand_off_writing_chat":
{ Args: { "p_writing_chat_id": string }; Returns: Json
                           },
"mark_provider_key_invalid":
{ Args: { "p_ai_job_id": string,"p_failure_cause": string }; Returns: boolean
                           },
"mark_writing_chat_extracted":
{ Args: { "p_sequence": number,"p_writing_chat_id": string }; Returns: number
                           },
"record_consents":
{ Args: { "items": Json,"user_agent_hash"?: string }; Returns: {
              "agreed_version": string,"consent_type": string,"current_version": string,"needs_consent": boolean,"required": boolean
            }[]
                           },
"record_provider_key_check":
{ Args: { "p_failure_cause"?: string,"p_provider": string,"p_result_status": string }; Returns: Json
                           },
"record_provider_key_success":
{ Args: { "p_ai_job_id": string }; Returns: boolean
                           },
"reorder_project_details":
{ Args: { "p_ordered_ids": (string)[],"p_project_id": string }; Returns: undefined
                           },
"request_ai_job_cancel":
{ Args: { "p_job_id": string }; Returns: Json
                           },
"save_provider_key":
{ Args: { "p_connection_tier": string,"p_disclosure_version": string,"p_encryption_version"?: number,"p_failure_cause"?: string,"p_kek_id": string,"p_key_ciphertext": string,"p_key_id": string,"p_key_last4": string,"p_key_nonce": string,"p_provider": string,"p_verification_result": string,"p_wrapped_dek": string }; Returns: Json
                           },
"save_writing_chat":
{ Args: { "p_writing_chat_id": string }; Returns: Json
                           },
"set_active_ai_provider":
{ Args: { "p_provider": string }; Returns: undefined
                           },
"set_writing_chat_affiliation":
{ Args: { "p_dismiss_only"?: boolean,"p_education_id"?: string,"p_experience_id"?: string,"p_writing_chat_id": string }; Returns: undefined
                           },
"start_writing_chat":
{ Args: { "p_mode": string,"p_project_id"?: string,"p_return_target"?: Json }; Returns: string
                           },
"sweep_stalled_ai_jobs":
{ Args: { "p_stalled_before": string }; Returns: number
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
