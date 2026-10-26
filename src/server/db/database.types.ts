
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
    }
                  ]
                },"ai_jobs": {
                  Row: {
                    "application_project_id": string | null,"attempt_count": number,"cancel_requested_at": string | null,"created_at": string,"error_category": string | null,"error_code": string | null,"finished_at": string | null,"heartbeat_at": string | null,"id": string,"input_hash": string | null,"job_type": string,"model": string | null,"output": Json | null,"params": NonNullable<Json>,"progress": Json | null,"prompt_version": string | null,"started_at": string | null,"status": string,"step_outputs": NonNullable<Json>,"target_id": string | null,"target_type": string | null,"updated_at": string,"usage": Json | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "application_project_id"?: string | null,"attempt_count"?: number,"cancel_requested_at"?: string | null,"created_at"?: string,"error_category"?: never,"error_code"?: string | null,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input_hash"?: string | null,"job_type": string,"model"?: string | null,"output"?: Json | null,"params"?: NonNullable<Json>,"progress"?: Json | null,"prompt_version"?: string | null,"started_at"?: string | null,"status"?: string,"step_outputs"?: NonNullable<Json>,"target_id"?: string | null,"target_type"?: string | null,"updated_at"?: string,"usage"?: Json | null,"user_id"?: string
                  }
                  Update: {
                    "application_project_id"?: string | null,"attempt_count"?: number,"cancel_requested_at"?: string | null,"created_at"?: string,"error_category"?: never,"error_code"?: string | null,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input_hash"?: string | null,"job_type"?: string,"model"?: string | null,"output"?: Json | null,"params"?: NonNullable<Json>,"progress"?: Json | null,"prompt_version"?: string | null,"started_at"?: string | null,"status"?: string,"step_outputs"?: NonNullable<Json>,"target_id"?: string | null,"target_type"?: string | null,"updated_at"?: string,"usage"?: Json | null,"user_id"?: string
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
                    "career_data_updated_at": string | null,"created_at": string,"desired_job_title": string | null,"display_name": string | null,"id": string,"inactivity_notice_sent_at": string | null,"interested_industries": (string)[],"last_active_at": string | null,"total_years_of_experience": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "career_data_updated_at"?: string | null,"created_at"?: string,"desired_job_title"?: string | null,"display_name"?: string | null,"id": string,"inactivity_notice_sent_at"?: string | null,"interested_industries"?: (string)[],"last_active_at"?: string | null,"total_years_of_experience"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "career_data_updated_at"?: string | null,"created_at"?: string,"desired_job_title"?: string | null,"display_name"?: string | null,"id"?: string,"inactivity_notice_sent_at"?: string | null,"interested_industries"?: (string)[],"last_active_at"?: string | null,"total_years_of_experience"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    
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
                },"usage_events": {
                  Row: {
                    "ai_job_id": string | null,"created_at": string,"feature": string,"id": string,"period_month": string,"reason": string,"status": string,"units": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_job_id"?: string | null,"created_at"?: string,"feature": string,"id"?: string,"period_month": string,"reason"?: string,"status"?: string,"units"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "ai_job_id"?: string | null,"created_at"?: string,"feature"?: string,"id"?: string,"period_month"?: string,"reason"?: string,"status"?: string,"units"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"usage_limits": {
                  Row: {
                    "created_at": string,"effective_from": string,"feature": string,"id": string,"monthly_limit": number,"plan": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effective_from": string,"feature": string,"id"?: string,"monthly_limit": number,"plan"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"effective_from"?: string,"feature"?: string,"id"?: string,"monthly_limit"?: number,"plan"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "charge_usage":
{ Args: { "p_usage_event_id": string }; Returns: undefined
                           },
"charge_usage_for_job":
{ Args: { "p_ai_job_id": string }; Returns: number
                           },
"complete_ai_job":
{ Args: { "p_attempt_count": number,"p_job_id": string,"p_progress"?: Json,"p_usage_event_id": string }; Returns: number
                           },
"delete_career_item":
{ Args: { "p_affiliation_mode"?: string,"p_entity_id": string,"p_entity_type": string,"p_result_mode"?: string }; Returns: Json
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
"get_usage_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"record_consents":
{ Args: { "items": Json,"user_agent_hash"?: string }; Returns: {
              "agreed_version": string,"consent_type": string,"current_version": string,"needs_consent": boolean,"required": boolean
            }[]
                           },
"release_usage":
{ Args: { "p_usage_event_id": string }; Returns: undefined
                           },
"release_usage_for_job":
{ Args: { "p_ai_job_id": string }; Returns: number
                           },
"reorder_project_details":
{ Args: { "p_ordered_ids": (string)[],"p_project_id": string }; Returns: undefined
                           },
"request_ai_job_cancel":
{ Args: { "p_job_id": string }; Returns: Json
                           },
"reserve_usage":
{ Args: { "p_ai_job_id"?: string,"p_feature": string,"p_reason"?: string,"p_units"?: number }; Returns: string
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
