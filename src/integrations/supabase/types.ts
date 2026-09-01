export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      characters: {
        Row: {
          carried_gold: number
          created_at: string
          declared_vocation: string | null
          died_at: string | null
          died_in_expedition_id: string | null
          guild_id: string | null
          id: string
          invited_by_character_id: string | null
          is_alive: boolean
          is_bot: boolean
          level: number
          miracle_used: boolean
          name: string
          portrait: string | null
          profile_id: string
          vocation: string | null
          xp: number
        }
        Insert: {
          carried_gold?: number
          created_at?: string
          declared_vocation?: string | null
          died_at?: string | null
          died_in_expedition_id?: string | null
          guild_id?: string | null
          id?: string
          invited_by_character_id?: string | null
          is_alive?: boolean
          is_bot?: boolean
          level?: number
          miracle_used?: boolean
          name: string
          portrait?: string | null
          profile_id: string
          vocation?: string | null
          xp?: number
        }
        Update: {
          carried_gold?: number
          created_at?: string
          declared_vocation?: string | null
          died_at?: string | null
          died_in_expedition_id?: string | null
          guild_id?: string | null
          id?: string
          invited_by_character_id?: string | null
          is_alive?: boolean
          is_bot?: boolean
          level?: number
          miracle_used?: boolean
          name?: string
          portrait?: string | null
          profile_id?: string
          vocation?: string | null
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "characters_died_in_expedition_fk"
            columns: ["died_in_expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_guild_id_fkey"
            columns: ["guild_id"]
            isOneToOne: false
            referencedRelation: "guilds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_invited_by_character_id_fkey"
            columns: ["invited_by_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          invitation_code: string | null
          read_at: string | null
          recipient_profile_id: string
          sender_profile_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          invitation_code?: string | null
          read_at?: string | null
          recipient_profile_id: string
          sender_profile_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          invitation_code?: string | null
          read_at?: string | null
          recipient_profile_id?: string
          sender_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_sender_profile_id_fkey"
            columns: ["sender_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_templates: {
        Row: {
          death_percentage: number
          event_type: string
          flavor_texts: string[]
          id: string
          loot_base_max: number
          loot_base_min: number
          risk_level: string
        }
        Insert: {
          death_percentage: number
          event_type: string
          flavor_texts: string[]
          id?: string
          loot_base_max: number
          loot_base_min: number
          risk_level: string
        }
        Update: {
          death_percentage?: number
          event_type?: string
          flavor_texts?: string[]
          id?: string
          loot_base_max?: number
          loot_base_min?: number
          risk_level?: string
        }
        Relationships: []
      }
      expedition_chat_messages: {
        Row: {
          character_id: string
          created_at: string
          expedition_id: string
          id: string
          message: string
        }
        Insert: {
          character_id: string
          created_at?: string
          expedition_id: string
          id?: string
          message: string
        }
        Update: {
          character_id?: string
          created_at?: string
          expedition_id?: string
          id?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedition_chat_messages_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedition_chat_messages_expedition_id_fkey"
            columns: ["expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_participants: {
        Row: {
          character_id: string
          expedition_id: string
          is_alive_at_end: boolean | null
          joined_at: string
        }
        Insert: {
          character_id: string
          expedition_id: string
          is_alive_at_end?: boolean | null
          joined_at?: string
        }
        Update: {
          character_id?: string
          expedition_id?: string
          is_alive_at_end?: boolean | null
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedition_participants_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedition_participants_expedition_id_fkey"
            columns: ["expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_steps: {
        Row: {
          created_at: string
          death_percentage: number
          deaths_count: number
          description: string | null
          event_type: string
          expedition_id: string
          id: string
          loot_max: number
          loot_min: number
          resolved: boolean
          resolved_at: string | null
          risk_level: string
          risk_revealed: boolean
          step_number: number
          vote_deadline: string | null
        }
        Insert: {
          created_at?: string
          death_percentage: number
          deaths_count?: number
          description?: string | null
          event_type: string
          expedition_id: string
          id?: string
          loot_max?: number
          loot_min?: number
          resolved?: boolean
          resolved_at?: string | null
          risk_level: string
          risk_revealed?: boolean
          step_number: number
          vote_deadline?: string | null
        }
        Update: {
          created_at?: string
          death_percentage?: number
          deaths_count?: number
          description?: string | null
          event_type?: string
          expedition_id?: string
          id?: string
          loot_max?: number
          loot_min?: number
          resolved?: boolean
          resolved_at?: string | null
          risk_level?: string
          risk_revealed?: boolean
          step_number?: number
          vote_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_steps_expedition_id_fkey"
            columns: ["expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_stakes: {
        Row: {
          activated_by_character_id: string
          cost: number
          created_at: string
          expedition_id: string
          stake_type: string
        }
        Insert: {
          activated_by_character_id: string
          cost: number
          created_at?: string
          expedition_id: string
          stake_type: string
        }
        Update: {
          activated_by_character_id?: string
          cost?: number
          created_at?: string
          expedition_id?: string
          stake_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedition_stakes_activated_by_character_id_fkey"
            columns: ["activated_by_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedition_stakes_expedition_id_fkey"
            columns: ["expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
        ]
      }
      expeditions: {
        Row: {
          created_at: string
          created_by_character_id: string
          ended_at: string | null
          guild_id: string
          id: string
          min_size: number
          started_at: string | null
          status: string
          target_size: number
          total_loot_earned: number
          total_loot_kept: number
          vote_window_seconds: number
        }
        Insert: {
          created_at?: string
          created_by_character_id: string
          ended_at?: string | null
          guild_id: string
          id?: string
          min_size?: number
          started_at?: string | null
          status?: string
          target_size: number
          total_loot_earned?: number
          total_loot_kept?: number
          vote_window_seconds?: number
        }
        Update: {
          created_at?: string
          created_by_character_id?: string
          ended_at?: string | null
          guild_id?: string
          id?: string
          min_size?: number
          started_at?: string | null
          status?: string
          target_size?: number
          total_loot_earned?: number
          total_loot_kept?: number
          vote_window_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "expeditions_created_by_character_id_fkey"
            columns: ["created_by_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expeditions_guild_id_fkey"
            columns: ["guild_id"]
            isOneToOne: false
            referencedRelation: "guilds"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_chat_messages: {
        Row: {
          character_id: string
          created_at: string
          guild_id: string
          id: string
          message: string
        }
        Insert: {
          character_id: string
          created_at?: string
          guild_id: string
          id?: string
          message: string
        }
        Update: {
          character_id?: string
          created_at?: string
          guild_id?: string
          id?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_chat_messages_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guild_chat_messages_guild_id_fkey"
            columns: ["guild_id"]
            isOneToOne: false
            referencedRelation: "guilds"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_join_requests: {
        Row: {
          character_id: string
          created_at: string
          guild_id: string
          id: string
          resolved_at: string | null
          resolved_by_character_id: string | null
          status: string
        }
        Insert: {
          character_id: string
          created_at?: string
          guild_id: string
          id?: string
          resolved_at?: string | null
          resolved_by_character_id?: string | null
          status?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          guild_id?: string
          id?: string
          resolved_at?: string | null
          resolved_by_character_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_join_requests_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guild_join_requests_guild_id_fkey"
            columns: ["guild_id"]
            isOneToOne: false
            referencedRelation: "guilds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guild_join_requests_resolved_by_character_id_fkey"
            columns: ["resolved_by_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_history_events: {
        Row: {
          character_id: string | null
          created_at: string
          description: string
          event_type: string
          expedition_id: string | null
          guild_id: string
          id: string
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          description: string
          event_type: string
          expedition_id?: string | null
          guild_id: string
          id?: string
        }
        Update: {
          character_id?: string | null
          created_at?: string
          description?: string
          event_type?: string
          expedition_id?: string | null
          guild_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_history_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guild_history_events_expedition_id_fkey"
            columns: ["expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guild_history_events_guild_id_fkey"
            columns: ["guild_id"]
            isOneToOne: false
            referencedRelation: "guilds"
            referencedColumns: ["id"]
          },
        ]
      }
      guilds: {
        Row: {
          banner: string | null
          banner_bg: string | null
          banner_color: string | null
          banner_symbol: string | null
          created_at: string
          founder_profile_id: string
          gold: number
          id: string
          name: string
        }
        Insert: {
          banner?: string | null
          banner_bg?: string | null
          banner_color?: string | null
          banner_symbol?: string | null
          created_at?: string
          founder_profile_id: string
          gold?: number
          id?: string
          name: string
        }
        Update: {
          banner?: string | null
          banner_bg?: string | null
          banner_color?: string | null
          banner_symbol?: string | null
          created_at?: string
          founder_profile_id?: string
          gold?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "guilds_founder_profile_id_fkey"
            columns: ["founder_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          code: string
          created_at: string
          created_by_profile_id: string
          id: string
          used_at: string | null
          used_by_profile_id: string | null
        }
        Insert: {
          code?: string
          created_at?: string
          created_by_profile_id: string
          id?: string
          used_at?: string | null
          used_by_profile_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by_profile_id?: string
          id?: string
          used_at?: string | null
          used_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_used_by_profile_id_fkey"
            columns: ["used_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          invited_by_profile_id: string | null
          is_admin: boolean
          last_seen_at: string | null
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          invited_by_profile_id?: string | null
          is_admin?: boolean
          last_seen_at?: string | null
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by_profile_id?: string | null
          is_admin?: boolean
          last_seen_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_invited_by_profile_id_fkey"
            columns: ["invited_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vocation_triggers: {
        Row: {
          ability: string
          character_id: string
          created_at: string
          expedition_id: string
          id: string
          step_id: string | null
        }
        Insert: {
          ability: string
          character_id: string
          created_at?: string
          expedition_id: string
          id?: string
          step_id?: string | null
        }
        Update: {
          ability?: string
          character_id?: string
          created_at?: string
          expedition_id?: string
          id?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vocation_triggers_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocation_triggers_expedition_id_fkey"
            columns: ["expedition_id"]
            isOneToOne: false
            referencedRelation: "expeditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocation_triggers_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "expedition_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      step_acknowledgments: {
        Row: {
          acknowledged_at: string
          character_id: string
          step_id: string
        }
        Insert: {
          acknowledged_at?: string
          character_id: string
          step_id: string
        }
        Update: {
          acknowledged_at?: string
          character_id?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_acknowledgments_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_acknowledgments_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "expedition_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      step_votes: {
        Row: {
          character_id: string
          id: string
          step_id: string
          vote: string
          voted_at: string
        }
        Insert: {
          character_id: string
          id?: string
          step_id: string
          vote: string
          voted_at?: string
        }
        Update: {
          character_id?: string
          id?: string
          step_id?: string
          vote?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_votes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_votes_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "expedition_steps"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      award_xp_to_survivors: {
        Args: {
          p_expedition_id: string
          p_is_final?: boolean
          p_risk_level: string
        }
        Returns: undefined
      }
      bootstrap_first_profile: {
        Args: { p_username: string }
        Returns: {
          created_at: string
          id: string
          invited_by_profile_id: string | null
          username: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cast_vote: {
        Args: { p_character_id: string; p_step_id: string; p_vote: string }
        Returns: undefined
      }
      create_character: {
        Args: { p_name: string }
        Returns: {
          carried_gold: number
          created_at: string
          died_at: string | null
          died_in_expedition_id: string | null
          guild_id: string | null
          id: string
          invited_by_character_id: string | null
          is_alive: boolean
          level: number
          name: string
          portrait: string | null
          profile_id: string
          xp: number
        }
        SetofOptions: {
          from: "*"
          to: "characters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_expedition: {
        Args: {
          p_character_id: string
          p_guild_id: string
          p_target_size: number
        }
        Returns: {
          created_at: string
          created_by_character_id: string
          ended_at: string | null
          guild_id: string
          id: string
          min_size: number
          started_at: string | null
          status: string
          target_size: number
          total_loot_earned: number
          total_loot_kept: number
          vote_window_seconds: number
        }
        SetofOptions: {
          from: "*"
          to: "expeditions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_guild: {
        Args: { p_character_id: string; p_guild_name: string }
        Returns: {
          banner: string | null
          banner_bg: string | null
          banner_color: string | null
          banner_symbol: string | null
          created_at: string
          founder_profile_id: string
          gold: number
          id: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "guilds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invitation: {
        Args: never
        Returns: {
          code: string
          created_at: string
          created_by_profile_id: string
          id: string
          used_at: string | null
          used_by_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_profile: {
        Args: { p_username: string }
        Returns: {
          created_at: string
          id: string
          invited_by_profile_id: string | null
          username: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_join_request: {
        Args: { p_character_id: string; p_request_id: string }
        Returns: {
          character_id: string
          created_at: string
          guild_id: string
          id: string
          resolved_at: string | null
          resolved_by_character_id: string | null
          status: string
        }
      }
      create_join_request: {
        Args: { p_character_id: string; p_guild_id: string }
        Returns: {
          character_id: string
          created_at: string
          guild_id: string
          id: string
          resolved_at: string | null
          resolved_by_character_id: string | null
          status: string
        }
      }
      respond_to_join_request: {
        Args: { p_accept: boolean; p_request_id: string; p_responder_character_id: string }
        Returns: {
          character_id: string
          created_at: string
          guild_id: string
          id: string
          resolved_at: string | null
          resolved_by_character_id: string | null
          status: string
        }
      }
      admin_spawn_bots: {
        Args: { p_guild_id: string }
        Returns: {
          carried_gold: number
          created_at: string
          declared_vocation: string | null
          died_at: string | null
          died_in_expedition_id: string | null
          guild_id: string | null
          id: string
          invited_by_character_id: string | null
          is_alive: boolean
          is_bot: boolean
          level: number
          miracle_used: boolean
          name: string
          portrait: string | null
          profile_id: string
          vocation: string | null
          xp: number
        }[]
      }
      admin_debug_expedition: {
        Args: { p_expedition_id: string }
        Returns: Json
      }
      acknowledge_step_result: {
        Args: { p_step_id: string; p_character_id: string }
        Returns: undefined
      }
      admin_bot_vote: {
        Args: { p_step_id: string; p_bot_character_id: string; p_vote: string }
        Returns: undefined
      }
      admin_revive_bot: {
        Args: { p_bot_character_id: string }
        Returns: undefined
      }
      choose_expedition_stake: {
        Args: { p_expedition_id: string; p_character_id: string; p_stake_type: string }
        Returns: {
          activated_by_character_id: string
          cost: number
          created_at: string
          expedition_id: string
          stake_type: string
        }
      }
      choose_vocation: {
        Args: { p_character_id: string; p_vocation: string }
        Returns: undefined
      }
      declare_vocation: {
        Args: { p_character_id: string; p_declared_vocation: string }
        Returns: undefined
      }
      get_my_vocation: {
        Args: { p_character_id: string }
        Returns: string
      }
      get_visible_risk: {
        Args: { p_step_id: string }
        Returns: number
      }
      reveal_risk: {
        Args: { p_step_id: string; p_character_id: string }
        Returns: number
      }
      trigger_martyr: {
        Args: { p_step_id: string; p_character_id: string }
        Returns: undefined
      }
      trigger_traitre_gambit: {
        Args: { p_step_id: string; p_character_id: string }
        Returns: undefined
      }
      inspect_vocation: {
        Args: { p_caller_character_id: string; p_target_character_id: string }
        Returns: boolean
      }
      set_guild_banner: {
        Args: { p_guild_id: string; p_character_id: string; p_symbol: string; p_color: string }
        Returns: {
          banner: string | null
          banner_bg: string | null
          banner_color: string | null
          banner_symbol: string | null
          created_at: string
          founder_profile_id: string
          gold: number
          id: string
          name: string
        }
      }
      heartbeat: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      generate_next_step:
        | {
            Args: { p_expedition_id: string }
            Returns: {
              created_at: string
              death_percentage: number
              deaths_count: number
              description: string | null
              event_type: string
              expedition_id: string
              id: string
              loot_max: number
              loot_min: number
              resolved: boolean
              resolved_at: string | null
              risk_level: string
              step_number: number
              vote_deadline: string | null
            }
            SetofOptions: {
              from: "*"
              to: "expedition_steps"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { p_expedition_id: string; p_vote_window_seconds?: number }
            Returns: {
              created_at: string
              death_percentage: number
              deaths_count: number
              description: string | null
              event_type: string
              expedition_id: string
              id: string
              loot_max: number
              loot_min: number
              resolved: boolean
              resolved_at: string | null
              risk_level: string
              step_number: number
              vote_deadline: string | null
            }
            SetofOptions: {
              from: "*"
              to: "expedition_steps"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      join_guild: {
        Args: {
          p_character_id: string
          p_guild_id: string
          p_invited_by_character_id: string
        }
        Returns: {
          carried_gold: number
          created_at: string
          died_at: string | null
          died_in_expedition_id: string | null
          guild_id: string | null
          id: string
          invited_by_character_id: string | null
          is_alive: boolean
          level: number
          name: string
          portrait: string | null
          profile_id: string
          xp: number
        }
        SetofOptions: {
          from: "*"
          to: "characters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      join_guild_with_code: {
        Args: { p_character_id: string; p_code: string; p_username?: string }
        Returns: {
          banner: string | null
          banner_bg: string | null
          banner_color: string | null
          banner_symbol: string | null
          created_at: string
          founder_profile_id: string
          gold: number
          id: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "guilds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_guild: {
        Args: { p_character_id: string }
        Returns: {
          carried_gold: number
          created_at: string
          died_at: string | null
          died_in_expedition_id: string | null
          guild_id: string | null
          id: string
          invited_by_character_id: string | null
          is_alive: boolean
          level: number
          name: string
          portrait: string | null
          profile_id: string
          xp: number
        }
        SetofOptions: {
          from: "*"
          to: "characters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      redeem_invitation: {
        Args: { p_code: string; p_username: string }
        Returns: {
          created_at: string
          id: string
          invited_by_profile_id: string | null
          username: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_step: {
        Args: { p_step_id: string }
        Returns: {
          created_at: string
          death_percentage: number
          deaths_count: number
          description: string | null
          event_type: string
          expedition_id: string
          id: string
          loot_max: number
          loot_min: number
          resolved: boolean
          resolved_at: string | null
          risk_level: string
          step_number: number
          vote_deadline: string | null
        }
        SetofOptions: {
          from: "*"
          to: "expedition_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_expedition: {
        Args: { p_character_id: string; p_expedition_id: string }
        Returns: {
          created_at: string
          death_percentage: number
          deaths_count: number
          description: string | null
          event_type: string
          expedition_id: string
          id: string
          loot_max: number
          loot_min: number
          resolved: boolean
          resolved_at: string | null
          risk_level: string
          step_number: number
          vote_deadline: string | null
        }
        SetofOptions: {
          from: "*"
          to: "expedition_steps"
          isOneToOne: true
          isSetofReturn: false
        }
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
