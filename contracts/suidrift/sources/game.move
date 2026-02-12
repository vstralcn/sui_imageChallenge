module suidrift::game {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::event;
    use sui::ed25519;
    use sui::clock::{Self, Clock};
    use std::vector;

    const EInvalidAmount: u64 = 0;
    const EGameFull: u64 = 1;
    const ENotPlayer: u64 = 2;
    const EInvalidSignature: u64 = 3;
    const EGameAlreadySettled: u64 = 4;
    const ENotAdmin: u64 = 5;
    const ENotCreator: u64 = 6;
    const EGameNotWaiting: u64 = 7;
    const EGameNotActive: u64 = 8;
    const ETimeoutNotReached: u64 = 9;
    const EPlayerBMissing: u64 = 10;

    const ACTIVE_TIMEOUT_MS: u64 = 5 * 60 * 1000; // 5 minutes

    public struct Game has key, store {
        id: UID,
        player_a: address,
        player_b: Option<address>,
        stake_amount: u64,
        balance: Balance<SUI>,
        status: u8, // 0: Waiting, 1: Active, 2: Settled, 3: Cancelled, 4: Refunded
        started_at_ms: u64,
        winner: Option<address>,
        walrus_blob_id: vector<u8>,
    }

    public struct AdminCap has key, store {
        id: UID,
    }
    
    public struct GameConfig has key, store {
        id: UID,
        public_key: vector<u8>, // Ed25519 public key of the oracle
    }

    // Events
    public struct GameCreated has copy, drop {
        game_id: ID,
        player_a: address,
        stake_amount: u64,
    }

    public struct GameJoined has copy, drop {
        game_id: ID,
        player_b: address,
        stake_amount: u64,
    }

    public struct GameSettled has copy, drop {
        game_id: ID,
        winner: address,
        amount: u64,
        walrus_blob_id: vector<u8>,
    }

    public struct GameCancelled has copy, drop {
        game_id: ID,
        player_a: address,
        amount: u64,
    }

    public struct GameRefunded has copy, drop {
        game_id: ID,
        player_a: address,
        player_b: address,
        amount_a: u64,
        amount_b: u64,
    }

    fun init(ctx: &mut TxContext) {
        // Initialize AdminCap
        transfer::transfer(AdminCap {
            id: object::new(ctx),
        }, ctx.sender());
    }

    public entry fun create_config(cap: &AdminCap, public_key: vector<u8>, ctx: &mut TxContext) {
        let config = GameConfig {
            id: object::new(ctx),
            public_key,
        };
        transfer::share_object(config);
    }

    public entry fun update_config(cap: &AdminCap, config: &mut GameConfig, public_key: vector<u8>, _ctx: &mut TxContext) {
        config.public_key = public_key;
    }
    
    // Create a new game with caller-defined stake amount.
    public entry fun create_game(payment: Coin<SUI>, ctx: &mut TxContext) {
        let payment_value = coin::value(&payment);
        assert!(payment_value > 0, EInvalidAmount);
        
        let id = object::new(ctx);
        let game_id = object::uid_to_inner(&id);
        
        let game = Game {
            id,
            player_a: ctx.sender(),
            player_b: option::none(),
            stake_amount: payment_value,
            balance: coin::into_balance(payment),
            status: 0, // Waiting
            started_at_ms: 0,
            winner: option::none(),
            walrus_blob_id: vector::empty<u8>(),
        };
        
        event::emit(GameCreated {
            game_id,
            player_a: ctx.sender(),
            stake_amount: payment_value,
        });
        
        transfer::share_object(game);
    }

    // Join an existing game with the same stake amount as player A.
    public entry fun join_game(game: &mut Game, payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext) {
        assert!(game.status == 0, EGameFull);
        assert!(coin::value(&payment) == game.stake_amount, EInvalidAmount);
        assert!(option::is_none(&game.player_b), EGameFull);

        let player_b = ctx.sender();
        option::fill(&mut game.player_b, player_b);
        balance::join(&mut game.balance, coin::into_balance(payment));
        game.status = 1; // Active
        game.started_at_ms = clock::timestamp_ms(clock);
        
        event::emit(GameJoined {
            game_id: object::uid_to_inner(&game.id),
            player_b,
            stake_amount: game.stake_amount,
        });
    }

    public entry fun cancel_waiting_game(game: &mut Game, ctx: &mut TxContext) {
        assert!(game.status == 0, EGameNotWaiting);
        assert!(ctx.sender() == game.player_a, ENotCreator);
        assert!(option::is_none(&game.player_b), EGameNotWaiting);

        let amount = balance::value(&game.balance);
        let refund = coin::take(&mut game.balance, amount, ctx);
        transfer::public_transfer(refund, game.player_a);

        game.status = 3;

        event::emit(GameCancelled {
            game_id: object::uid_to_inner(&game.id),
            player_a: game.player_a,
            amount,
        });
    }

    public entry fun refund_active_game_timeout(game: &mut Game, clock: &Clock, ctx: &mut TxContext) {
        assert!(game.status == 1, EGameNotActive);
        assert!(option::is_some(&game.player_b), EPlayerBMissing);

        let caller = ctx.sender();
        let player_b = *option::borrow(&game.player_b);
        let is_player = caller == game.player_a || caller == player_b;
        assert!(is_player, ENotPlayer);

        let now_ms = clock::timestamp_ms(clock);
        assert!(now_ms >= game.started_at_ms, ETimeoutNotReached);
        assert!(now_ms - game.started_at_ms >= ACTIVE_TIMEOUT_MS, ETimeoutNotReached);

        let amount_a = balance::value(&game.balance) / 2;
        let refund_a = coin::take(&mut game.balance, amount_a, ctx);
        transfer::public_transfer(refund_a, game.player_a);

        let amount_b = balance::value(&game.balance);
        let refund_b = coin::take(&mut game.balance, amount_b, ctx);
        transfer::public_transfer(refund_b, player_b);

        game.status = 4;

        event::emit(GameRefunded {
            game_id: object::uid_to_inner(&game.id),
            player_a: game.player_a,
            player_b,
            amount_a,
            amount_b,
        });
    }

    // Oracle signs (game_id_bytes + winner_address_bytes)
    // Settle the game and distribute funds
    public entry fun settle_game(
        game: &mut Game, 
        config: &GameConfig,
        signature: vector<u8>, 
        walrus_blob_id: vector<u8>,
        winner: address, 
        ctx: &mut TxContext
    ) {
        assert!(game.status == 1, EGameAlreadySettled);
        
        // Verify signature
        // Message construction: game_id (ID) + winner (address)
        let mut msg = vector::empty<u8>();
        let game_id_bytes = object::uid_to_bytes(&game.id);
        vector::append(&mut msg, game_id_bytes);
        
        // Convert address to bytes using bcs
        let winner_bytes = sui::bcs::to_bytes(&winner);
        vector::append(&mut msg, winner_bytes);

        vector::append(&mut msg, copy walrus_blob_id);

        // Ed25519 verification
        assert!(
            ed25519::ed25519_verify(&signature, &config.public_key, &msg),
            EInvalidSignature
        );

        // Verify winner is one of the players
        // Note: Check if winner is a player is good, but signature is authority.
        // But let's check just in case.
        let is_player = winner == game.player_a || (option::is_some(&game.player_b) && winner == *option::borrow(&game.player_b));
        assert!(is_player, ENotPlayer);

        game.status = 2; // Settled
        game.winner = option::some(winner);
        game.walrus_blob_id = copy walrus_blob_id;
        
        let reward_amount = balance::value(&game.balance);
        let reward = coin::take(&mut game.balance, reward_amount, ctx);
        
        transfer::public_transfer(reward, winner);
        
        event::emit(GameSettled {
            game_id: object::uid_to_inner(&game.id),
            winner,
            amount: reward_amount,
            walrus_blob_id,
        });
    }
}
