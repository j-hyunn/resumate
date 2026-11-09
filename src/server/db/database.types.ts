
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
            "account_deletion_logs": {
                  Row: {
                    "created_at": string,"db_deleted_at": string | null,"id": string,"reason": string,"requested_at": string,"storage_deleted_at": string | null,"subject_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"db_deleted_at"?: string | null,"id"?: string,"reason": string,"requested_at"?: string,"storage_deleted_at"?: string | null,"subject_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"db_deleted_at"?: string | null,"id"?: string,"reason"?: string,"requested_at"?: string,"storage_deleted_at"?: string | null,"subject_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
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
                    {
      foreignKeyName: "ai_jobs_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
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
                    "ai_job_id": string | null,"application_project_id": string | null,"cache_write_tokens": number,"cached_input_tokens": number,"call_key": string | null,"connection_tier": string,"created_at": string,"error_code": string | null,"estimated_cost_usd": number,"feature": string,"id": string,"input_cost_usd": number,"input_tokens": number,"job_type": string,"model": string,"model_tier": string,"occurred_at": string,"outcome": string,"output_cost_usd": number,"output_tokens": number,"period_month": string,"price_table_version": string,"provider": string,"reasoning_tokens": number | null,"usage_source": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_job_id"?: string | null,"application_project_id"?: string | null,"cache_write_tokens"?: number,"cached_input_tokens"?: number,"call_key"?: string | null,"connection_tier": string,"created_at"?: string,"error_code"?: string | null,"estimated_cost_usd": number,"feature": string,"id"?: string,"input_cost_usd"?: number,"input_tokens"?: number,"job_type": string,"model": string,"model_tier": string,"occurred_at"?: string,"outcome": string,"output_cost_usd"?: number,"output_tokens"?: number,"period_month"?: string,"price_table_version": string,"provider": string,"reasoning_tokens"?: number | null,"usage_source": string,"user_id"?: string
                  }
                  Update: {
                    "ai_job_id"?: string | null,"application_project_id"?: string | null,"cache_write_tokens"?: number,"cached_input_tokens"?: number,"call_key"?: string | null,"connection_tier"?: string,"created_at"?: string,"error_code"?: string | null,"estimated_cost_usd"?: number,"feature"?: string,"id"?: string,"input_cost_usd"?: number,"input_tokens"?: number,"job_type"?: string,"model"?: string,"model_tier"?: string,"occurred_at"?: string,"outcome"?: string,"output_cost_usd"?: number,"output_tokens"?: number,"period_month"?: string,"price_table_version"?: string,"provider"?: string,"reasoning_tokens"?: number | null,"usage_source"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_records_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"application_documents": {
                  Row: {
                    "application_project_id": string,"body": NonNullable<Json>,"created_at": string,"document_kind": string,"filled_slot_count": number,"first_copied_at": string | null,"id": string,"meta": NonNullable<Json>,"slot_count": number | null,"slot_high_water": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id": string,"body"?: NonNullable<Json>,"created_at"?: string,"document_kind": string,"filled_slot_count"?: number,"first_copied_at"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"slot_count"?: never,"slot_high_water"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string,"body"?: NonNullable<Json>,"created_at"?: string,"document_kind"?: string,"filled_slot_count"?: number,"first_copied_at"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"slot_count"?: never,"slot_high_water"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_documents_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"application_projects": {
                  Row: {
                    "created_at": string,"deadline": string | null,"duplicated_from_id": string | null,"id": string,"last_activity_at": string,"memo": string | null,"name": string | null,"name_source": string | null,"stage": string,"stage_changed_at": string,"stage_outcome": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deadline"?: string | null,"duplicated_from_id"?: string | null,"id"?: string,"last_activity_at"?: string,"memo"?: string | null,"name"?: string | null,"name_source"?: string | null,"stage"?: string,"stage_changed_at"?: string,"stage_outcome"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deadline"?: string | null,"duplicated_from_id"?: string | null,"id"?: string,"last_activity_at"?: string,"memo"?: string | null,"name"?: string | null,"name_source"?: string | null,"stage"?: string,"stage_changed_at"?: string,"stage_outcome"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_projects_duplicated_from_fkey"
      columns: ["duplicated_from_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"application_stage_events": {
                  Row: {
                    "application_project_id": string,"created_at": string,"event_type": string,"from_outcome": string | null,"from_stage": string | null,"id": string,"to_outcome": string | null,"to_stage": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id": string,"created_at"?: string,"event_type": string,"from_outcome"?: string | null,"from_stage"?: string | null,"id"?: string,"to_outcome"?: string | null,"to_stage": string,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string,"created_at"?: string,"event_type"?: string,"from_outcome"?: string | null,"from_stage"?: string | null,"id"?: string,"to_outcome"?: string | null,"to_stage"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_stage_events_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
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
                    {
      foreignKeyName: "evidence_links_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
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
                },"insights": {
                  Row: {
                    "ai_job_id": string | null,"application_project_id": string,"career_snapshot_hash": string | null,"completed_at": string | null,"connection_tier": string | null,"created_at": string,"id": string,"input_hash": string | null,"is_latest": boolean,"match_stage_result": Json | null,"model": string | null,"model_tier": string | null,"prompt_version": string | null,"provider": string | null,"requirements_hash": string | null,"result": Json | null,"run_generation": number | null,"schema_version": number | null,"status": string,"updated_at": string,"usage": Json | null,"user_id": string,"validation_report": Json | null,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_job_id"?: string | null,"application_project_id": string,"career_snapshot_hash"?: string | null,"completed_at"?: string | null,"connection_tier"?: string | null,"created_at"?: string,"id"?: string,"input_hash"?: string | null,"is_latest"?: boolean,"match_stage_result"?: Json | null,"model"?: string | null,"model_tier"?: string | null,"prompt_version"?: string | null,"provider"?: string | null,"requirements_hash"?: string | null,"result"?: Json | null,"run_generation"?: number | null,"schema_version"?: number | null,"status"?: string,"updated_at"?: string,"usage"?: Json | null,"user_id"?: string,"validation_report"?: Json | null,"version_no": number
                  }
                  Update: {
                    "ai_job_id"?: string | null,"application_project_id"?: string,"career_snapshot_hash"?: string | null,"completed_at"?: string | null,"connection_tier"?: string | null,"created_at"?: string,"id"?: string,"input_hash"?: string | null,"is_latest"?: boolean,"match_stage_result"?: Json | null,"model"?: string | null,"model_tier"?: string | null,"prompt_version"?: string | null,"provider"?: string | null,"requirements_hash"?: string | null,"result"?: Json | null,"run_generation"?: number | null,"schema_version"?: number | null,"status"?: string,"updated_at"?: string,"usage"?: Json | null,"user_id"?: string,"validation_report"?: Json | null,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "insights_ai_job_fkey"
      columns: ["ai_job_id","user_id"]
isOneToOne: false
      referencedRelation: "ai_jobs"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "insights_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"jd_requirements": {
                  Row: {
                    "category": string,"content": string,"created_at": string,"id": string,"importance": string,"is_user_edited": boolean,"job_description_id": string,"keywords": (string)[],"origin": string,"sort_order": number,"source_sids": (string)[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"content": string,"created_at"?: string,"id"?: string,"importance"?: string,"is_user_edited"?: boolean,"job_description_id": string,"keywords"?: (string)[],"origin"?: string,"sort_order"?: number,"source_sids": (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "category"?: string,"content"?: string,"created_at"?: string,"id"?: string,"importance"?: string,"is_user_edited"?: boolean,"job_description_id"?: string,"keywords"?: (string)[],"origin"?: string,"sort_order"?: number,"source_sids"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jd_requirements_job_description_fkey"
      columns: ["job_description_id","user_id"]
isOneToOne: false
      referencedRelation: "job_descriptions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"job_descriptions": {
                  Row: {
                    "application_project_id": string,"company_name": string | null,"company_name_source": string | null,"created_at": string,"detected_language": string | null,"extraction": Json | null,"extraction_job_id": string | null,"extraction_model": string | null,"extraction_provider": string | null,"extraction_status": string,"id": string,"position_title": string | null,"position_title_source": string | null,"raw_text": string,"raw_text_edited_at": string | null,"raw_text_hash": string,"requirements_hash": string | null,"sentences": NonNullable<Json>,"source_url": string | null,"tech_keywords": Json | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id": string,"company_name"?: string | null,"company_name_source"?: string | null,"created_at"?: string,"detected_language"?: string | null,"extraction"?: Json | null,"extraction_job_id"?: string | null,"extraction_model"?: string | null,"extraction_provider"?: string | null,"extraction_status"?: string,"id"?: string,"position_title"?: string | null,"position_title_source"?: string | null,"raw_text": string,"raw_text_edited_at"?: string | null,"raw_text_hash": string,"requirements_hash"?: string | null,"sentences": NonNullable<Json>,"source_url"?: string | null,"tech_keywords"?: Json | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string,"company_name"?: string | null,"company_name_source"?: string | null,"created_at"?: string,"detected_language"?: string | null,"extraction"?: Json | null,"extraction_job_id"?: string | null,"extraction_model"?: string | null,"extraction_provider"?: string | null,"extraction_status"?: string,"id"?: string,"position_title"?: string | null,"position_title_source"?: string | null,"raw_text"?: string,"raw_text_edited_at"?: string | null,"raw_text_hash"?: string,"requirements_hash"?: string | null,"sentences"?: NonNullable<Json>,"source_url"?: string | null,"tech_keywords"?: Json | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_descriptions_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "job_descriptions_extraction_job_fkey"
      columns: ["extraction_job_id","user_id"]
isOneToOne: false
      referencedRelation: "ai_jobs"
      referencedColumns: ["id","user_id"]
    }
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
                },"profile_job_interests": {
                  Row: {
                    "created_at": string,"job_family": string,"job_role": string | null,"sort_order": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"job_family": string,"job_role"?: string | null,"sort_order": number,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"job_family"?: string,"job_role"?: string | null,"sort_order"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profile_options": {
                  Row: {
                    "category": string,"code": string,"created_at": string,"is_active": boolean,"label": string,"parent_code": string | null,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"code": string,"created_at"?: string,"is_active"?: boolean,"label": string,"parent_code"?: string | null,"sort_order": number,"updated_at"?: string
                  }
                  Update: {
                    "category"?: string,"code"?: string,"created_at"?: string,"is_active"?: boolean,"label"?: string,"parent_code"?: string | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "active_ai_provider": string | null,"career_data_updated_at": string | null,"created_at": string,"display_name": string | null,"highest_education_degree": string | null,"highest_education_end_month": string | null,"highest_education_gpa": string | null,"highest_education_major": string | null,"highest_education_school_name": string | null,"highest_education_start_month": string | null,"highest_education_status": string | null,"id": string,"inactivity_notice_sent_at": string | null,"interested_company_type": string | null,"interested_industry": string | null,"job_search_status": string | null,"last_active_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_ai_provider"?: string | null,"career_data_updated_at"?: string | null,"created_at"?: string,"display_name"?: string | null,"highest_education_degree"?: string | null,"highest_education_end_month"?: string | null,"highest_education_gpa"?: string | null,"highest_education_major"?: string | null,"highest_education_school_name"?: string | null,"highest_education_start_month"?: string | null,"highest_education_status"?: string | null,"id": string,"inactivity_notice_sent_at"?: string | null,"interested_company_type"?: string | null,"interested_industry"?: string | null,"job_search_status"?: string | null,"last_active_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active_ai_provider"?: string | null,"career_data_updated_at"?: string | null,"created_at"?: string,"display_name"?: string | null,"highest_education_degree"?: string | null,"highest_education_end_month"?: string | null,"highest_education_gpa"?: string | null,"highest_education_major"?: string | null,"highest_education_school_name"?: string | null,"highest_education_start_month"?: string | null,"highest_education_status"?: string | null,"id"?: string,"inactivity_notice_sent_at"?: string | null,"interested_company_type"?: string | null,"interested_industry"?: string | null,"job_search_status"?: string | null,"last_active_at"?: string | null,"updated_at"?: string
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
                },"project_deliverables": {
                  Row: {
                    "body": string,"created_at": string,"id": string,"project_id": string,"sort_order": number,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"created_at"?: string,"id"?: string,"project_id": string,"sort_order"?: number,"title": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"id"?: string,"project_id"?: string,"sort_order"?: number,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_deliverables_project_fkey"
      columns: ["project_id","user_id"]
isOneToOne: false
      referencedRelation: "projects"
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
                    "action": string | null,"competencies": (string)[],"content_updated_at": string,"created_at": string,"description": string | null,"education_id": string | null,"end_month": string | null,"experience_id": string | null,"experience_type": string | null,"id": string,"is_current": boolean,"learnings": string | null,"link_url": string | null,"name": string,"project_type": string | null,"result": string | null,"role": string | null,"situation": string | null,"source_writing_chat_id": string | null,"start_month": string | null,"status": string,"task": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action"?: string | null,"competencies"?: (string)[],"content_updated_at"?: string,"created_at"?: string,"description"?: string | null,"education_id"?: string | null,"end_month"?: string | null,"experience_id"?: string | null,"experience_type"?: string | null,"id"?: string,"is_current"?: boolean,"learnings"?: string | null,"link_url"?: string | null,"name": string,"project_type"?: string | null,"result"?: string | null,"role"?: string | null,"situation"?: string | null,"source_writing_chat_id"?: string | null,"start_month"?: string | null,"status"?: string,"task"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "action"?: string | null,"competencies"?: (string)[],"content_updated_at"?: string,"created_at"?: string,"description"?: string | null,"education_id"?: string | null,"end_month"?: string | null,"experience_id"?: string | null,"experience_type"?: string | null,"id"?: string,"is_current"?: boolean,"learnings"?: string | null,"link_url"?: string | null,"name"?: string,"project_type"?: string | null,"result"?: string | null,"role"?: string | null,"situation"?: string | null,"source_writing_chat_id"?: string | null,"start_month"?: string | null,"status"?: string,"task"?: string | null,"updated_at"?: string,"user_id"?: string
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
                    "application_project_id": string | null,"created_at": string,"document_kind": string | null,"id": string,"last_activity_at": string,"last_applied_at": string | null,"last_extracted_sequence": number,"message_count": number,"project_deliverable_id": string | null,"project_id": string | null,"return_target": Json | null,"status": string,"structured_draft": NonNullable<Json>,"title": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id"?: string | null,"created_at"?: string,"document_kind"?: string | null,"id"?: string,"last_activity_at"?: string,"last_applied_at"?: string | null,"last_extracted_sequence"?: number,"message_count"?: number,"project_deliverable_id"?: string | null,"project_id"?: string | null,"return_target"?: Json | null,"status"?: string,"structured_draft"?: NonNullable<Json>,"title"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string | null,"created_at"?: string,"document_kind"?: string | null,"id"?: string,"last_activity_at"?: string,"last_applied_at"?: string | null,"last_extracted_sequence"?: number,"message_count"?: number,"project_deliverable_id"?: string | null,"project_id"?: string | null,"return_target"?: Json | null,"status"?: string,"structured_draft"?: NonNullable<Json>,"title"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "writing_chats_application_project_fkey"
      columns: ["application_project_id","user_id"]
isOneToOne: false
      referencedRelation: "application_projects"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "writing_chats_project_deliverable_fkey"
      columns: ["project_deliverable_id","project_id","user_id"]
isOneToOne: false
      referencedRelation: "project_deliverables"
      referencedColumns: ["id","project_id","user_id"]
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
                    "connection_tier": string | null,"created_at": string | null,"id": string | null,"key_last4": string | null,"last_failure_at": string | null,"last_failure_cause": string | null,"last_verified_at": string | null,"provider": string | null,"status": string | null,"updated_at": string | null
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
"apply_jd_extraction":
{ Args: { "p_ai_job_id": string,"p_job_description_id": string,"p_model": string,"p_provider": string,"p_result": Json,"p_run_generation": number }; Returns: Json
                           },
"apply_structured_draft_patch":
{ Args: { "p_patch": Json,"p_writing_chat_id": string }; Returns: Json
                           },
"begin_assistant_message":
{ Args: { "p_ai_job_id": string,"p_connection_tier": string,"p_model": string,"p_model_tier": string,"p_provider": string,"p_writing_chat_id": string }; Returns: {
              "is_final": boolean,"message_count": number,"message_id": string,"reused": boolean,"sequence": number
            }[]
                           },
"begin_insight":
{ Args: { "p_ai_job_id": string,"p_application_project_id": string }; Returns: string
                           },
"begin_jd_extraction":
{ Args: { "p_ai_job_id": string,"p_job_description_id": string }; Returns: undefined
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
"complete_insight":
{ Args: { "p_ai_job_id": string,"p_insight_id": string,"p_payload": Json,"p_run_generation": number }; Returns: Json
                           },
"compute_total_experience_months":
{ Args: { "p_as_of": string }; Returns: {
              "as_of_month": string,"open_ended_experience_count": number,"total_months": number
            }[]
                           },
"create_application_project":
{ Args: { "p_company_name"?: string,"p_deadline"?: string,"p_id": string,"p_name"?: string,"p_position_title"?: string,"p_preview_job_id"?: string,"p_raw_text": string,"p_raw_text_hash": string,"p_sentences": Json,"p_source_url"?: string }; Returns: Json
                           },
"delete_account":
{ Args: { "p_subject_hash": string }; Returns: Json
                           },
"delete_career_item":
{ Args: { "p_affiliation_mode"?: string,"p_entity_id": string,"p_entity_type": string,"p_result_mode"?: string }; Returns: Json
                           },
"delete_provider_key":
{ Args: { "p_provider": string }; Returns: boolean
                           },
"fail_insight":
{ Args: { "p_ai_job_id": string,"p_insight_id": string }; Returns: boolean
                           },
"fail_jd_extraction":
{ Args: { "p_ai_job_id": string,"p_job_description_id": string }; Returns: boolean
                           },
"finish_assistant_message":
{ Args: { "p_content": string,"p_message_id": string,"p_status": string }; Returns: undefined
                           },
"get_account_deletion_state":
{ Args: { "p_subject_hash": string,"p_user_id": string }; Returns: string
                           },
"get_account_deletion_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
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
"list_inactive_accounts_due":
{ Args: { "p_limit"?: number,"p_now": string }; Returns: {
              "user_id": string
            }[]
                           },
"list_inactivity_notice_targets":
{ Args: { "p_limit"?: number,"p_now": string }; Returns: {
              "email": string,"last_active_at": string,"user_id": string
            }[]
                           },
"list_incomplete_account_deletions":
{ Args: { "p_limit"?: number }; Returns: {
              "user_id": string
            }[]
                           },
"mark_application_document_copied":
{ Args: { "p_application_project_id": string,"p_document_kind"?: string }; Returns: string
                           },
"mark_inactivity_notice_sent":
{ Args: { "p_sent_at": string,"p_user_id": string }; Returns: boolean
                           },
"mark_provider_key_invalid":
{ Args: { "p_ai_job_id": string,"p_failure_cause": string }; Returns: boolean
                           },
"mark_writing_chat_extracted":
{ Args: { "p_sequence": number,"p_writing_chat_id": string }; Returns: number
                           },
"move_application_stage":
{ Args: { "p_application_project_id": string,"p_outcome"?: string,"p_to_stage": string }; Returns: Json
                           },
"purge_inactive_account":
{ Args: { "p_now": string,"p_subject_hash": string,"p_user_id": string }; Returns: Json
                           },
"purge_old_account_deletion_logs":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: number
                           },
"purge_old_ai_jobs":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: number
                           },
"purge_old_ai_usage_records":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: number
                           },
"purge_unused_jd_preview_outputs":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: number
                           },
"record_consents":
{ Args: { "items": Json,"user_agent_hash"?: string }; Returns: {
              "agreed_version": string,"consent_type": string,"current_version": string,"needs_consent": boolean,"required": boolean
            }[]
                           },
"record_provider_key_check":
{ Args: { "p_failure_cause"?: string,"p_provider": string,"p_result_status": string,"p_user_id": string }; Returns: Json
                           },
"record_provider_key_success":
{ Args: { "p_ai_job_id": string }; Returns: boolean
                           },
"reorder_project_deliverables":
{ Args: { "p_ordered_ids": (string)[],"p_project_id": string }; Returns: undefined
                           },
"request_ai_job_cancel":
{ Args: { "p_job_id": string }; Returns: Json
                           },
"retry_ai_job":
{ Args: { "p_ai_job_id": string,"p_expected_connection_tier"?: string,"p_expected_provider": string,"p_expected_run_generation": number,"p_model": string,"p_model_tier": string,"p_run_meta": Json }; Returns: Json
                           },
"save_application_document":
{ Args: { "p_application_project_id": string,"p_application_values"?: Json,"p_applied_proposals"?: Json,"p_body": Json,"p_client_id"?: string,"p_document_kind": string,"p_expected_updated_at"?: string,"p_meta"?: Json }; Returns: Json
                           },
"save_profile_basics":
{ Args: { "p_expected_updated_at"?: string,"p_job_interests"?: Json,"p_values": Json }; Returns: Json
                           },
"save_project_deliverable":
{ Args: { "p_applied_proposals"?: Json,"p_body": string,"p_client_id"?: string,"p_expected_updated_at"?: string,"p_project_deliverable_id": string,"p_project_id": string,"p_title": string }; Returns: Json
                           },
"save_project_page":
{ Args: { "p_applied_proposals"?: Json,"p_client_id"?: string,"p_expected_updated_at"?: string,"p_project_id": string,"p_values": Json }; Returns: Json
                           },
"save_provider_key":
{ Args: { "p_connection_tier": string,"p_disclosure_version": string,"p_encryption_version"?: number,"p_failure_cause"?: string,"p_kek_id": string,"p_key_ciphertext": string,"p_key_id": string,"p_key_last4": string,"p_key_nonce": string,"p_provider": string,"p_user_id": string,"p_verification_result": string,"p_wrapped_dek": string }; Returns: Json
                           },
"set_active_ai_provider":
{ Args: { "p_provider": string }; Returns: undefined
                           },
"set_application_outcome":
{ Args: { "p_application_project_id": string,"p_outcome": string }; Returns: Json
                           },
"start_deliverable_writing_chat":
{ Args: { "p_form_snapshot"?: Json,"p_project_deliverable_id": string }; Returns: string
                           },
"start_document_writing_chat":
{ Args: { "p_application_project_id": string,"p_document_kind": string,"p_form_snapshot"?: Json }; Returns: string
                           },
"start_writing_chat":
{ Args: { "p_form_snapshot"?: Json,"p_project_id": string,"p_return_target"?: Json }; Returns: string
                           },
"sweep_stalled_ai_jobs":
{ Args: { "p_stalled_before": string }; Returns: number
                           },
"touch_last_active":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"update_failed_jd_raw_text":
{ Args: { "p_application_project_id": string,"p_raw_text": string,"p_raw_text_hash": string,"p_sentences": Json }; Returns: Json
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
