export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action_type: string
          actor_id: string
          created_at: string
          detail: Json
          id: string
          target_id: string
          target_table: string
        }
        Insert: {
          action_type: string
          actor_id: string
          created_at?: string
          detail?: Json
          id?: string
          target_id: string
          target_table: string
        }
        Update: {
          action_type?: string
          actor_id?: string
          created_at?: string
          detail?: Json
          id?: string
          target_id?: string
          target_table?: string
        }
        Relationships: []
      }
      boost_packages: {
        Row: {
          active: boolean
          created_at: string
          duration_days: number
          id: string
          price_kes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          duration_days: number
          id?: string
          price_kes: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          duration_days?: number
          id?: string
          price_kes?: number
          updated_at?: string
        }
        Relationships: []
      }
      boosts: {
        Row: {
          created_at: string
          duration_days: number
          expires_at: string | null
          id: string
          listing_id: string
          package_id: string
          paystack_reference: string
          price_kes_charged: number
          seller_id: string
          starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_days: number
          expires_at?: string | null
          id?: string
          listing_id: string
          package_id: string
          paystack_reference: string
          price_kes_charged: number
          seller_id: string
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_days?: number
          expires_at?: string | null
          id?: string
          listing_id?: string
          package_id?: string
          paystack_reference?: string
          price_kes_charged?: number
          seller_id?: string
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boosts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boosts_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "boost_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boosts_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          buyer_id: string
          buyer_last_read_at: string
          created_at: string
          id: string
          last_message_at: string
          listing_id: string
          seller_id: string
          seller_last_read_at: string
        }
        Insert: {
          buyer_id: string
          buyer_last_read_at?: string
          created_at?: string
          id?: string
          last_message_at?: string
          listing_id: string
          seller_id: string
          seller_last_read_at?: string
        }
        Update: {
          buyer_id?: string
          buyer_last_read_at?: string
          created_at?: string
          id?: string
          last_message_at?: string
          listing_id?: string
          seller_id?: string
          seller_last_read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          id: string
          opened_by: string
          order_id: string
          reason: string
          refund_reference: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          opened_by: string
          order_id: string
          reason: string
          refund_reference?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          opened_by?: string
          order_id?: string
          reason?: string
          refund_reference?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          position?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          boosted_until: string | null
          category_id: string
          city: string
          condition: Database["public"]["Enums"]["item_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          location_area: string | null
          price: number
          published_at: string | null
          quantity: number
          rating_sum: number
          removed_prior_status:
            | Database["public"]["Enums"]["listing_status"]
            | null
          review_count: number
          search_vector: unknown
          seller_id: string
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          type: Database["public"]["Enums"]["listing_type"]
          updated_at: string
        }
        Insert: {
          boosted_until?: string | null
          category_id: string
          city?: string
          condition?: Database["public"]["Enums"]["item_condition"] | null
          created_at?: string
          currency?: string
          description: string
          id?: string
          location_area?: string | null
          price: number
          published_at?: string | null
          quantity?: number
          rating_sum?: number
          removed_prior_status?:
            | Database["public"]["Enums"]["listing_status"]
            | null
          review_count?: number
          search_vector?: unknown
          seller_id: string
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          type: Database["public"]["Enums"]["listing_type"]
          updated_at?: string
        }
        Update: {
          boosted_until?: string | null
          category_id?: string
          city?: string
          condition?: Database["public"]["Enums"]["item_condition"] | null
          created_at?: string
          currency?: string
          description?: string
          id?: string
          location_area?: string | null
          price?: number
          published_at?: string | null
          quantity?: number
          rating_sum?: number
          removed_prior_status?:
            | Database["public"]["Enums"]["listing_status"]
            | null
          review_count?: number
          search_vector?: unknown
          seller_id?: string
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          type?: Database["public"]["Enums"]["listing_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string
          id: string
          payload: Json
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          id?: string
          payload?: Json
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          id?: string
          payload?: Json
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_total: number
          buyer_id: string
          cancelled_at: string | null
          commission_amount: number | null
          completed_at: string | null
          created_at: string
          expired_at: string | null
          id: string
          listing_id: string
          paid_at: string | null
          paystack_authorization_url: string | null
          paystack_reference: string
          seller_id: string
          seller_net: number | null
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          amount_total: number
          buyer_id: string
          cancelled_at?: string | null
          commission_amount?: number | null
          completed_at?: string | null
          created_at?: string
          expired_at?: string | null
          id?: string
          listing_id: string
          paid_at?: string | null
          paystack_authorization_url?: string | null
          paystack_reference: string
          seller_id: string
          seller_net?: number | null
          status?: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          amount_total?: number
          buyer_id?: string
          cancelled_at?: string | null
          commission_amount?: number | null
          completed_at?: string | null
          created_at?: string
          expired_at?: string | null
          id?: string
          listing_id?: string
          paid_at?: string | null
          paystack_authorization_url?: string | null
          paystack_reference?: string
          seller_id?: string
          seller_net?: number | null
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          created_at: string
          event_type: string
          id: string
          order_id: string | null
          payload: Json
          paystack_reference: string | null
          processing_outcome: string
          provider: string
          signature_valid: boolean
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          order_id?: string | null
          payload: Json
          paystack_reference?: string | null
          processing_outcome: string
          provider?: string
          signature_valid: boolean
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          order_id?: string | null
          payload?: Json
          paystack_reference?: string | null
          processing_outcome?: string
          provider?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_recipients: {
        Row: {
          created_at: string
          id: string
          paystack_recipient_code: string
          phone_masked: string
          seller_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          paystack_recipient_code: string
          phone_masked: string
          seller_id: string
        }
        Update: {
          created_at?: string
          id?: string
          paystack_recipient_code?: string
          phone_masked?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_recipients_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_kes_cents: number
          created_at: string
          fee_kes_cents: number
          id: string
          origin: string
          paystack_transfer_reference: string
          recipient_code: string
          seller_id: string
          status: string
          transfer_amount_kes_cents: number | null
          updated_at: string
        }
        Insert: {
          amount_kes_cents: number
          created_at?: string
          fee_kes_cents?: number
          id?: string
          origin: string
          paystack_transfer_reference: string
          recipient_code: string
          seller_id: string
          status?: string
          transfer_amount_kes_cents?: number | null
          updated_at?: string
        }
        Update: {
          amount_kes_cents?: number
          created_at?: string
          fee_kes_cents?: number
          id?: string
          origin?: string
          paystack_transfer_reference?: string
          recipient_code?: string
          seller_id?: string
          status?: string
          transfer_amount_kes_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          rating_sum: number
          review_count: number
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id: string
          rating_sum?: number
          review_count?: number
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          rating_sum?: number
          review_count?: number
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles_private: {
        Row: {
          email_activity: boolean
          id: string
          location: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          email_activity?: boolean
          id: string
          location?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          email_activity?: boolean
          id?: string
          location?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_private_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string | null
          buyer_id: string
          created_at: string
          id: string
          listing_id: string
          order_id: string
          rating: number
          seller_id: string
          seller_responded_at: string | null
          seller_response: string | null
          status: Database["public"]["Enums"]["review_status"]
        }
        Insert: {
          body?: string | null
          buyer_id: string
          created_at?: string
          id?: string
          listing_id: string
          order_id: string
          rating: number
          seller_id: string
          seller_responded_at?: string | null
          seller_response?: string | null
          status?: Database["public"]["Enums"]["review_status"]
        }
        Update: {
          body?: string | null
          buyer_id?: string
          created_at?: string
          id?: string
          listing_id?: string
          order_id?: string
          rating?: number
          seller_id?: string
          seller_responded_at?: string | null
          seller_response?: string | null
          status?: Database["public"]["Enums"]["review_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reviews_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_read_private_profile: {
        Args: { p_profile_id: string }
        Returns: {
          email_activity: boolean
          id: string
          location: string
          phone: string
          updated_at: string
        }[]
      }
      admin_resolve_dispute: {
        Args: {
          p_dispute_id: string
          p_outcome: string
          p_refund_reference?: string
          p_resolution_note: string
        }
        Returns: {
          created_at: string
          id: string
          opened_by: string
          order_id: string
          reason: string
          refund_reference: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "disputes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_review_dispute: {
        Args: { p_dispute_id: string }
        Returns: {
          created_at: string
          id: string
          opened_by: string
          order_id: string
          reason: string
          refund_reference: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "disputes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_listing_visibility: {
        Args: { p_action: string; p_listing_id: string; p_note?: string }
        Returns: {
          admin_action_id: string
          note: string
          prior_status: Database["public"]["Enums"]["listing_status"]
          seller_id: string
        }[]
      }
      admin_set_review_status: {
        Args: { p_action: string; p_review_id: string }
        Returns: {
          body: string | null
          buyer_id: string
          created_at: string
          id: string
          listing_id: string
          order_id: string
          rating: number
          seller_id: string
          seller_responded_at: string | null
          seller_response: string | null
          status: Database["public"]["Enums"]["review_status"]
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_terminate_boost: {
        Args: { p_boost_id: string }
        Returns: {
          created_at: string
          duration_days: number
          expires_at: string | null
          id: string
          listing_id: string
          package_id: string
          paystack_reference: string
          price_kes_charged: number
          seller_id: string
          starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "boosts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auto_complete_order: { Args: { p_order_id: string }; Returns: boolean }
      become_seller: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      cancel_pending_order: {
        Args: { p_order_id: string }
        Returns: {
          amount_total: number
          buyer_id: string
          cancelled_at: string | null
          commission_amount: number | null
          completed_at: string | null
          created_at: string
          expired_at: string | null
          id: string
          listing_id: string
          paid_at: string | null
          paystack_authorization_url: string | null
          paystack_reference: string
          seller_id: string
          seller_net: number | null
          status: Database["public"]["Enums"]["order_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_order: {
        Args: { p_order_id: string }
        Returns: {
          amount_total: number
          buyer_id: string
          cancelled_at: string | null
          commission_amount: number | null
          completed_at: string | null
          created_at: string
          expired_at: string | null
          id: string
          listing_id: string
          paid_at: string | null
          paystack_authorization_url: string | null
          paystack_reference: string
          seller_id: string
          seller_net: number | null
          status: Database["public"]["Enums"]["order_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conversation_is_sendable: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      create_pending_order: {
        Args: { p_listing_id: string; p_reference: string }
        Returns: {
          amount_total: number
          buyer_id: string
          cancelled_at: string | null
          commission_amount: number | null
          completed_at: string | null
          created_at: string
          expired_at: string | null
          id: string
          listing_id: string
          paid_at: string | null
          paystack_authorization_url: string | null
          paystack_reference: string
          seller_id: string
          seller_net: number | null
          status: Database["public"]["Enums"]["order_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dispute_party: { Args: { p_order_id: string }; Returns: boolean }
      expire_pending_order: { Args: { p_order_id: string }; Returns: boolean }
      finalize_order_payment: {
        Args: { p_reference: string; p_verified_amount: number }
        Returns: {
          amount_total: number
          buyer_id: string
          cancelled_at: string | null
          commission_amount: number | null
          completed_at: string | null
          created_at: string
          expired_at: string | null
          id: string
          listing_id: string
          paid_at: string | null
          paystack_authorization_url: string | null
          paystack_reference: string
          seller_id: string
          seller_net: number | null
          status: Database["public"]["Enums"]["order_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin: { Args: never; Returns: boolean }
      is_conversation_participant: {
        Args: { conv_id: string }
        Returns: boolean
      }
      is_seller: { Args: never; Returns: boolean }
      is_seller_or_admin: { Args: never; Returns: boolean }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      open_dispute: {
        Args: { p_order_id: string; p_reason: string }
        Returns: string
      }
      payout_sweep_candidates: {
        Args: { p_min_kes_cents: number }
        Returns: {
          amount_kes_cents: number
          recipient_code: string
          seller_id: string
        }[]
      }
      search_listings: {
        Args: {
          category_ids?: string[]
          conditions?: Database["public"]["Enums"]["item_condition"][]
          location?: string
          max_price?: number
          min_price?: number
          q?: string[]
          sort?: string
        }
        Returns: {
          boosted_until: string | null
          category_id: string
          city: string
          condition: Database["public"]["Enums"]["item_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          location_area: string | null
          price: number
          published_at: string | null
          quantity: number
          rating_sum: number
          removed_prior_status:
            | Database["public"]["Enums"]["listing_status"]
            | null
          review_count: number
          search_vector: unknown
          seller_id: string
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          type: Database["public"]["Enums"]["listing_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      seller_available_balance: {
        Args: { p_seller_id: string }
        Returns: number
      }
      seller_pending_balance: { Args: { p_seller_id: string }; Returns: number }
      set_order_authorization_url: {
        Args: { p_order_id: string; p_url: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soft_delete_listing: { Args: { p_id: string }; Returns: boolean }
      submit_seller_response: {
        Args: { response: string; review_id: string }
        Returns: {
          body: string | null
          buyer_id: string
          created_at: string
          id: string
          listing_id: string
          order_id: string
          rating: number
          seller_id: string
          seller_responded_at: string | null
          seller_response: string | null
          status: Database["public"]["Enums"]["review_status"]
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_boost_status: {
        Args: { p_boost_id: string; p_new_status: string }
        Returns: {
          created_at: string
          duration_days: number
          expires_at: string | null
          id: string
          listing_id: string
          package_id: string
          paystack_reference: string
          price_kes_charged: number
          seller_id: string
          starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "boosts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_payout_status: {
        Args: { p_new_status: string; p_payout_id: string }
        Returns: {
          amount_kes_cents: number
          created_at: string
          fee_kes_cents: number
          id: string
          origin: string
          paystack_transfer_reference: string
          recipient_code: string
          seller_id: string
          status: string
          transfer_amount_kes_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      item_condition: "new" | "used_like_new" | "used_good" | "used_fair"
      listing_status:
        | "draft"
        | "active"
        | "paused"
        | "sold"
        | "removed"
        | "deleted"
      listing_type: "product" | "service"
      order_status:
        | "pending_payment"
        | "paid"
        | "completed"
        | "cancelled"
        | "expired"
      payment_method: "mpesa" | "card"
      payment_status: "initiated" | "processing" | "succeeded" | "failed"
      review_status: "visible" | "hidden"
      user_role: "buyer" | "seller" | "admin"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      item_condition: ["new", "used_like_new", "used_good", "used_fair"],
      listing_status: [
        "draft",
        "active",
        "paused",
        "sold",
        "removed",
        "deleted",
      ],
      listing_type: ["product", "service"],
      order_status: [
        "pending_payment",
        "paid",
        "completed",
        "cancelled",
        "expired",
      ],
      payment_method: ["mpesa", "card"],
      payment_status: ["initiated", "processing", "succeeded", "failed"],
      review_status: ["visible", "hidden"],
      user_role: ["buyer", "seller", "admin"],
    },
  },
} as const

