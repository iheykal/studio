import { useReducer, useCallback, useEffect, useRef } from 'react';
import type { GameState, Player, PlayerColor, Token, LegalMove, TokenPosition, MultiplayerMessage } from '../types';
import { PLAYER_COLORS, START_POSITIONS, HOME_ENTRANCES, HOME_PATH_LENGTH, SAFE_SQUARES } from '../lib/boardLayout';
import { getAIMove } from '../services/geminiService';
import { socketService } from '../services/socketService';
import { audioService } from '../services/audioService';

// --- Multiplayer Service (WebSocket communication) ---
const multiplayerService = {
  init: (gameId: string, onMessage: (message: MultiplayerMessage) => void) => {
    socketService.connect();
    
    // Handle game actions from other players
    socketService.onGameAction(({ action, playerId }) => {
      onMessage({
        type: 'GAME_ACTION',
        payload: { action, sessionId: playerId }
      });
    });

    // Handle game state updates from server
    socketService.onGameStateUpdate(({ state }) => {
      console.log('📥 Received game state update from server');
      onMessage({
        type: 'GAME_STATE_UPDATE',
        payload: { state, sessionId: 'server' }
      });
    });
  },
  broadcast: (gameId: string, message: MultiplayerMessage, playerId: string) => {
    if (message.type === 'GAME_ACTION') {
      socketService.sendGameAction(
        message.payload.action,
        playerId
      );
    } else if (message.type === 'GAME_STATE_UPDATE') {
      socketService.sendGameStateUpdate(message.payload.state);
    }
  },
  close: () => {
    socketService.disconnect();
  },
};

// --- Game Logic ---
export type Action =
    | { type: 'START_GAME'; players: Player[]; initialState?: GameState }
    | { type: 'ROLL_DICE'; value: number }
    | { type: 'SET_LEGAL_MOVES_AND_PROCEED'; moves: LegalMove[] }
    | { type: 'MOVE_TOKEN'; move: LegalMove }
    | { type: 'NEXT_TURN'; grantExtraTurn: boolean }
    | { type: 'ANIMATION_COMPLETE' }
    | { type: 'AI_THINKING' }
    | { type: 'SET_STATE'; state: GameState };

const initialState: GameState = {
    players: [],
    tokens: [],
    currentPlayerIndex: 0,
    diceValue: null,
    turnState: 'ROLLING',
    message: 'Welcome to Ludo!',
    gameStarted: false,
    winners: [],
    legalMoves: [],
};

const reducer = (state: GameState, action: Action): GameState => {
    switch (action.type) {
        case 'START_GAME': {
            if (action.initialState) {
                return action.initialState;
            }
            // Ensure players are always in the same order (red, yellow)
            const sortedPlayers = [...action.players].sort((a, b) => {
                const order: PlayerColor[] = ['red', 'yellow', 'green', 'blue'];
                return order.indexOf(a.color) - order.indexOf(b.color);
            });
            
            const tokens: Token[] = sortedPlayers.flatMap(p =>
                Array.from({ length: 4 }, (_, i) => ({
                    id: `${p.color}-${i}`,
                    color: p.color,
                    position: { type: 'YARD', index: i },
                }))
            );
            
            console.log('🎮 START_GAME - Players order:', sortedPlayers.map(p => `${p.color}: ${p.name || 'Unknown'}`));
            
            return {
                ...initialState,
                gameStarted: true,
                players: sortedPlayers,
                tokens,
                currentPlayerIndex: 0,
                turnState: 'ROLLING',
                message: '',
            };
        }
        
        case 'SET_STATE':
            return action.state;

        case 'ROLL_DICE': {
            // Clear _pendingExtraTurn at the start of a new turn (dice roll)
            // This ensures we don't use stale values from previous turns
            return {
                ...state,
                diceValue: action.value,
                turnState: 'MOVING',
                message: `${state.players[state.currentPlayerIndex].color} rolled a ${action.value}. Select a token to move.`,
                _pendingExtraTurn: undefined,
            };
        }
        
        case 'SET_LEGAL_MOVES_AND_PROCEED': {
             if (action.moves.length === 0) {
                 return {
                    ...state,
                    legalMoves: [],
                    message: `No legal moves. Passing turn.`,
                 }
            }
            return { ...state, legalMoves: action.moves };
        }
        
        case 'MOVE_TOKEN': {
            const { move } = action;
            const diceValue = state.diceValue!;
            const currentPlayerColor = state.players[state.currentPlayerIndex].color;
            let captured = false;

            let newTokens = state.tokens.map(t =>
                t.id === move.tokenId ? { ...t, position: move.finalPosition } : { ...t }
            );
            
            if (move.finalPosition.type === 'PATH' && !SAFE_SQUARES.includes(move.finalPosition.index)) {
                const targetPos = move.finalPosition.index;
                const opponentTokensAtTarget = newTokens.filter(t =>
                    t.color !== currentPlayerColor &&
                    t.position.type === 'PATH' &&
                    t.position.index === targetPos
                );
                
                const isBlockade = opponentTokensAtTarget.length > 1 &&
                    opponentTokensAtTarget.every(t => t.color === opponentTokensAtTarget[0].color);

                if (!isBlockade && opponentTokensAtTarget.length > 0) {
                    newTokens = newTokens.map(t => {
                        if (opponentTokensAtTarget.some(ot => ot.id === t.id)) {
                            captured = true;
                            return { ...t, position: { type: 'YARD', index: parseInt(t.id.split('-')[1]) } };
                        }
                        return t;
                    });
                    // Play kill sound when a pawn is captured
                    if (captured) {
                        audioService.play('kill');
                    }
                }
            }
            
            // Play move sound for regular moves (if not captured)
            if (!captured) {
                if (move.finalPosition.type === 'HOME') {
                    // Play special sound when token enters home
                    audioService.play('inHome');
                } else {
                    audioService.play('move');
                }
            }

            // Player gets another turn ONLY if:
            // 1. They rolled a 6, OR
            // 2. They captured/killed an opponent's pawn, OR
            // 3. They entered home (reached the final HOME position)
            const grantExtraTurn = diceValue === 6 || captured || move.finalPosition.type === 'HOME';
            console.log('🎯 MOVE_TOKEN - Extra turn calculation:', {
                diceValue,
                captured,
                enteredHome: move.finalPosition.type === 'HOME',
                grantExtraTurn,
                currentPlayerColor
            });

            const winners = [...state.winners];
            const playerTokens = newTokens.filter(t => t.color === currentPlayerColor);
            let winMessage = state.message;
            if (playerTokens.every(t => t.position.type === 'HOME')) {
                if (!winners.includes(currentPlayerColor)) {
                    winners.push(currentPlayerColor);
                    // Display player name when they complete their last pawn
                    const winningPlayer = state.players.find(p => p.color === currentPlayerColor);
                    const winningPlayerName = winningPlayer?.name || currentPlayerColor;
                    winMessage = `${winningPlayerName} has won! All pawns are home! 🏆`;
                    // Play win sound
                    audioService.play('win');
                }
            }

            const isGameOver = state.players.length - winners.length <= 1;

            if (isGameOver) {
                const remainingPlayer = state.players.find(p => !winners.includes(p.color));
                if (remainingPlayer) winners.push(remainingPlayer.color);

                // Get winner's name if available
                const winnerPlayer = state.players.find(p => p.color === winners[0]);
                const winnerName = winnerPlayer?.name || winners[0];

                return {
                    ...state,
                    tokens: newTokens,
                    winners,
                    turnState: 'GAMEOVER',
                    message: `${winnerName} is the winner!`,
                };
            }

            return {
                ...state,
                tokens: newTokens,
                winners,
                turnState: 'ANIMATING',
                message: winMessage || `${currentPlayerColor} is moving...`,
                legalMoves: [],
                _pendingExtraTurn: grantExtraTurn,
            };
        }

        case 'ANIMATION_COMPLETE': {
            // Guard: Only process if we're actually in ANIMATING state
            // This prevents duplicate processing or processing at wrong times
            if (state.turnState !== 'ANIMATING') {
                console.warn('⚠️ ANIMATION_COMPLETE received but state is not ANIMATING:', state.turnState);
                return state;
            }
            
            // Only use _pendingExtraTurn if it's explicitly set (not undefined)
            // This prevents using stale values from previous turns
            const shouldGrantExtraTurn = state._pendingExtraTurn === true;
            console.log('🔄 ANIMATION_COMPLETE - transitioning to next turn:', {
                _pendingExtraTurn: state._pendingExtraTurn,
                shouldGrantExtraTurn,
                currentPlayerIndex: state.currentPlayerIndex,
                diceValue: state.diceValue,
                turnState: state.turnState
            });
            const nextState = getNextTurnState(state, shouldGrantExtraTurn);
            console.log('🔄 ANIMATION_COMPLETE - next state:', nextState);
            return {
                ...state,
                ...nextState,
                _pendingExtraTurn: undefined, // Always clear after use
            };
        }

        case 'NEXT_TURN': {
            const nextState = getNextTurnState(state, action.grantExtraTurn);
            console.log('🔄 NEXT_TURN - transitioning to next turn:', {
                grantExtraTurn: action.grantExtraTurn,
                currentPlayerIndex: state.currentPlayerIndex,
                nextState
            });
            return { 
                ...state, 
                ...nextState,
                _pendingExtraTurn: undefined, // Always clear when transitioning turns
            };
        }
        
        case 'AI_THINKING': {
            return { ...state, message: `${state.players[state.currentPlayerIndex].color} (AI) is thinking...` };
        }

        default:
            return state;
    }
};

const getNextTurnState = (state: GameState, grantExtraTurn: boolean): Partial<GameState> => {
    if (!state.players || state.players.length === 0) {
        console.error('❌ getNextTurnState: No players in state');
        return {};
    }
    
    let nextPlayerIndex = grantExtraTurn ? state.currentPlayerIndex : (state.currentPlayerIndex + 1) % state.players.length;
    
    // Skip players who have already won
    let attempts = 0;
    while (state.winners.includes(state.players[nextPlayerIndex]?.color) && attempts < state.players.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % state.players.length;
        attempts++;
    }
    
    const nextPlayer = state.players[nextPlayerIndex];
    console.log('🔄 getNextTurnState:', {
        currentIndex: state.currentPlayerIndex,
        nextIndex: nextPlayerIndex,
        nextPlayerColor: nextPlayer?.color,
        grantExtraTurn,
        winners: state.winners
    });
    
    return {
        currentPlayerIndex: nextPlayerIndex,
        diceValue: null,
        turnState: 'ROLLING',
        message: '',
        legalMoves: [],
    };
};

interface MultiplayerConfig {
  gameId: string;
  localPlayerColor: PlayerColor;
  sessionId: string;
}

export const useGameLogic = (multiplayerConfig?: MultiplayerConfig) => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const isMultiplayer = !!multiplayerConfig;
    const isMyTurn = isMultiplayer
        ? state.players[state.currentPlayerIndex]?.color === multiplayerConfig.localPlayerColor
        : true;
    
    // Debug logging for turn state - this will help us see when state updates
    useEffect(() => {
        if (isMultiplayer && state.gameStarted && state.players.length > 0) {
            const currentPlayer = state.players[state.currentPlayerIndex];
            const calculatedIsMyTurn = currentPlayer?.color === multiplayerConfig.localPlayerColor;
            console.log('🎯 Turn state check:', {
                currentPlayerIndex: state.currentPlayerIndex,
                currentPlayerColor: currentPlayer?.color,
                myColor: multiplayerConfig.localPlayerColor,
                isMyTurn: calculatedIsMyTurn,
                turnState: state.turnState,
                canRoll: state.turnState === 'ROLLING' && calculatedIsMyTurn,
                players: state.players.map(p => p.color)
            });
        }
    }, [state.currentPlayerIndex, state.turnState, state.gameStarted, state.players, isMultiplayer, multiplayerConfig?.localPlayerColor]);
    
    const localDispatchRef = useRef(dispatch);
    localDispatchRef.current = dispatch;
    
    // Keep a ref to the current state for use in callbacks
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // --- Multiplayer Communication Effect ---
    useEffect(() => {
        if (!isMultiplayer) return;

        const handleMessage = (message: MultiplayerMessage) => {
            if (message.type === 'GAME_ACTION') {
                // Only process actions from other players (not our own)
                if (message.payload.sessionId !== multiplayerConfig.sessionId) {
                    // Received an action from the other player
                    const action = message.payload.action;
                    console.log('📨 Received action from other player:', {
                        actionType: action.type,
                        fromPlayer: message.payload.sessionId,
                        mySessionId: multiplayerConfig.sessionId
                    });
                    
                    // Dispatch the action - this will update the state
                    localDispatchRef.current(action);
                    
                    console.log('✅ Action dispatched, state will update on next render');
                } else {
                    // This is our own action - we already processed it locally, ignore
                    console.log('⏭️ Ignoring own action:', message.payload.action.type);
                }
            } else if (message.type === 'GAME_STATE_UPDATE') {
                // Received full state update from server (for sync/recovery)
                console.log('🔄 Received full state update from server, syncing...');
                localDispatchRef.current({ type: 'SET_STATE', state: message.payload.state });
            }
        };

        multiplayerService.init(multiplayerConfig.gameId, handleMessage);

        return () => multiplayerService.close();
    }, [isMultiplayer, multiplayerConfig?.gameId, multiplayerConfig?.sessionId]);

    const broadcastAction = useCallback((action: Action) => {
        if (!isMultiplayer) return;
        console.log('📡 Broadcasting action:', action.type, 'from player:', multiplayerConfig.sessionId);
        try {
            multiplayerService.broadcast(multiplayerConfig.gameId, {
                type: 'GAME_ACTION',
                payload: { action, sessionId: multiplayerConfig.sessionId }
            }, multiplayerConfig.sessionId);
        } catch (error) {
            console.error('❌ Error broadcasting action:', error);
        }
    }, [isMultiplayer, multiplayerConfig]);


    const calculateLegalMoves = useCallback((currentState: GameState, diceValue: number): LegalMove[] => {
        const { tokens, currentPlayerIndex, players } = currentState;
        if (!players[currentPlayerIndex]) return [];
        const currentPlayer = players[currentPlayerIndex];
        const moves: LegalMove[] = [];

        for (const token of tokens.filter(t => t.color === currentPlayer.color)) {
            const currentPos = token.position;

            if (currentPos.type === 'YARD') {
                if (diceValue === 6) {
                    const startPos = START_POSITIONS[currentPlayer.color];
                    const tokensOnStart = tokens.filter(t => t.position.type === 'PATH' && t.position.index === startPos && t.color === currentPlayer.color);
                    if (tokensOnStart.length < 2) {
                        moves.push({ tokenId: token.id, finalPosition: { type: 'PATH', index: startPos } });
                    }
                }
            } else if (currentPos.type === 'PATH') {
                const homeEntrance = HOME_ENTRANCES[currentPlayer.color];
                const newPathIndex = currentPos.index + diceValue;
                
                const distanceToHomeEntrance = (homeEntrance - currentPos.index + 52) % 52;
                
                if (diceValue > distanceToHomeEntrance) {
                    const stepsIntoHome = diceValue - distanceToHomeEntrance - 1;
                    if (stepsIntoHome < HOME_PATH_LENGTH) {
                        moves.push({ tokenId: token.id, finalPosition: { type: 'HOME_PATH', index: stepsIntoHome } });
                    } else if (stepsIntoHome === HOME_PATH_LENGTH) {
                        moves.push({ tokenId: token.id, finalPosition: { type: 'HOME' } });
                    }
                } else {
                    const finalIndex = (currentPos.index + diceValue) % 52;
                    const tokensAtDest = tokens.filter(t => t.position.type === 'PATH' && t.position.index === finalIndex && t.color === currentPlayer.color);
                    if (tokensAtDest.length < 2) {
                        moves.push({ tokenId: token.id, finalPosition: { type: 'PATH', index: finalIndex } });
                    }
                }
            } else if (currentPos.type === 'HOME_PATH') {
                const newHomeIndex = currentPos.index + diceValue;
                if (newHomeIndex < HOME_PATH_LENGTH) {
                    moves.push({ tokenId: token.id, finalPosition: { type: 'HOME_PATH', index: newHomeIndex } });
                } else if (newHomeIndex === HOME_PATH_LENGTH) {
                    moves.push({ tokenId: token.id, finalPosition: { type: 'HOME' } });
                }
            }
        }
        return moves;
    }, []);

    const handleRollDice = useCallback(async () => {
        console.log('🎲 handleRollDice called:', { 
            turnState: state.turnState, 
            isMyTurn, 
            currentPlayerIndex: state.currentPlayerIndex,
            currentPlayer: state.players[state.currentPlayerIndex]?.color,
            canRoll: state.turnState === 'ROLLING' && isMyTurn
        });
        if (state.turnState !== 'ROLLING' || !isMyTurn) {
            console.log('❌ Cannot roll dice:', { 
                reason: state.turnState !== 'ROLLING' ? 'Not ROLLING state' : 'Not my turn',
                turnState: state.turnState,
                isMyTurn
            });
            return;
        }

        const roll = Math.floor(Math.random() * 6) + 1;
        const rollAction: Action = { type: 'ROLL_DICE', value: roll };
        console.log('🎲 Rolling dice:', roll);
        dispatch(rollAction);
        broadcastAction(rollAction);
        // Play dice roll sound after dispatch (user has already interacted by clicking)
        setTimeout(() => {
          audioService.play('diceRoll');
        }, 50);

        // Use stateRef to get the latest state - this ensures we have the most up-to-date token positions
        // Critical when rolling multiple 6s in a row, as state might have changed from previous turns
        const latestState = stateRef.current;
        const currentPlayer = latestState.players[latestState.currentPlayerIndex];
        
        // Debug logging to help identify the issue
        const tokensInYard = latestState.tokens.filter(t => 
            t.color === currentPlayer?.color && 
            t.position.type === 'YARD'
        );
        const startPos = START_POSITIONS[currentPlayer?.color || 'red'];
        const tokensOnStart = latestState.tokens.filter(t => 
            t.color === currentPlayer?.color &&
            t.position.type === 'PATH' &&
            t.position.index === startPos
        );
        
        console.log('🔍 Calculating moves with latest state:', {
            currentPlayerColor: currentPlayer?.color,
            diceValue: roll,
            tokensInYard: tokensInYard.length,
            tokensInYardIds: tokensInYard.map(t => t.id),
            tokensOnStart: tokensOnStart.length,
            tokensOnStartIds: tokensOnStart.map(t => t.id),
            startPos
        });
        
        // Construct state after ROLL_DICE for accurate move calculation
        const stateAfterRoll = {
            ...latestState,
            diceValue: roll,
            turnState: 'MOVING' as const
        };
        
        const moves = calculateLegalMoves(stateAfterRoll, roll);
        const movesAction: Action = { type: 'SET_LEGAL_MOVES_AND_PROCEED', moves };
        console.log('📋 Legal moves calculated:', moves.length, moves.map(m => ({ tokenId: m.tokenId, pos: m.finalPosition })));
        dispatch(movesAction);
        broadcastAction(movesAction);

        if (moves.length === 0) {
            // If no legal moves available, player gets another turn ONLY if they rolled a 6
            setTimeout(() => {
                const nextTurnAction: Action = { type: 'NEXT_TURN', grantExtraTurn: roll === 6 };
                dispatch(nextTurnAction);
                broadcastAction(nextTurnAction);
            }, 1200);
        } else {
            if (currentPlayer.isAI && !isMultiplayer) { // AI only runs in single player
                dispatch({ type: 'AI_THINKING' });
                const currentStateForAI = { ...stateAfterRoll, legalMoves: moves };
                const aiMove = await getAIMove(currentStateForAI);
                if (aiMove) {
                    setTimeout(() => dispatch({ type: 'MOVE_TOKEN', move: aiMove }), 1000);
                } else {
                    setTimeout(() => dispatch({ type: 'NEXT_TURN', grantExtraTurn: false }), 1000);
                }
            }
        }
    }, [state, calculateLegalMoves, isMyTurn, isMultiplayer, broadcastAction]);

    const handleMoveToken = useCallback((tokenId: string) => {
        if (state.turnState !== 'MOVING' || !isMyTurn) {
            console.log('❌ Cannot move token:', { turnState: state.turnState, isMyTurn });
            return;
        }
        const move = state.legalMoves.find(m => m.tokenId === tokenId);
        if (move) {
            console.log('🎯 Moving token:', tokenId, 'to:', move.finalPosition);
            const moveAction: Action = { type: 'MOVE_TOKEN', move };
            dispatch(moveAction);
            broadcastAction(moveAction);
        } else {
            console.warn("Illegal move attempted for token:", tokenId);
        }
    }, [state.turnState, state.legalMoves, isMyTurn, broadcastAction]);
    
    const startGame = (players: Player[], initialState?: GameState) => dispatch({ type: 'START_GAME', players, initialState });

    const setState = (newState: GameState) => dispatch({ type: 'SET_STATE', state: newState });

    const handleAnimationComplete = useCallback(() => {
        // Use stateRef to get the latest state to avoid stale closures
        const currentState = stateRef.current;
        
        // Guard: Only process if we're actually in ANIMATING state
        if (currentState.turnState !== 'ANIMATING') {
            console.warn('⚠️ handleAnimationComplete called but state is not ANIMATING:', currentState.turnState);
            return;
        }
        
        // In multiplayer, only the player who made the move should trigger ANIMATION_COMPLETE
        // The other player will receive it via WebSocket
        const currentPlayer = currentState.players[currentState.currentPlayerIndex];
        const calculatedIsMyTurn = currentPlayer?.color === multiplayerConfig?.localPlayerColor;
        
        if (isMultiplayer && !calculatedIsMyTurn) {
            // Don't process locally if it's not our turn - wait for the broadcast
            console.log('⏸️ Skipping local ANIMATION_COMPLETE - waiting for broadcast from other player', {
                currentPlayerColor: currentPlayer?.color,
                myColor: multiplayerConfig?.localPlayerColor
            });
            return;
        }
        
        // Process locally and broadcast if multiplayer
        const nextTurnAction: Action = { type: 'ANIMATION_COMPLETE' };
        console.log('✅ Processing ANIMATION_COMPLETE', { 
            isMyTurn: calculatedIsMyTurn, 
            isMultiplayer,
            currentPlayerColor: currentPlayer?.color,
            _pendingExtraTurn: currentState._pendingExtraTurn
        });
        dispatch(nextTurnAction);
        
        // Broadcast in multiplayer so the other player receives it
        if (isMultiplayer) {
            broadcastAction(nextTurnAction);
            // Also send full state update after turn transition to ensure sync
            setTimeout(() => {
                // Use stateRef to get the latest state after the reducer has updated it
                const updatedState = stateRef.current;
                console.log('📤 Sending state sync after ANIMATION_COMPLETE');
                multiplayerService.broadcast(multiplayerConfig.gameId, {
                    type: 'GAME_STATE_UPDATE',
                    payload: { state: updatedState, sessionId: multiplayerConfig.sessionId }
                }, multiplayerConfig.sessionId);
            }, 500);
        }
    }, [isMultiplayer, broadcastAction, multiplayerConfig, dispatch]);

    useEffect(() => {
        const currentPlayer = state.players[state.currentPlayerIndex];
        if (state.turnState === 'ROLLING' && currentPlayer?.isAI && state.gameStarted && !isMultiplayer) {
            const timer = setTimeout(() => {
                handleRollDice();
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [state.turnState, state.currentPlayerIndex, state.players, state.gameStarted, handleRollDice, isMultiplayer]);

    // Periodic state synchronization check for multiplayer
    useEffect(() => {
        if (!isMultiplayer || !state.gameStarted) return;

        // Every 10 seconds, check if we're still in sync and request sync if needed
        const syncInterval = setInterval(() => {
            const currentPlayer = state.players[state.currentPlayerIndex];
            const expectedIsMyTurn = currentPlayer?.color === multiplayerConfig.localPlayerColor;
            
            if (state.turnState === 'ROLLING' && expectedIsMyTurn !== isMyTurn) {
                console.warn('⚠️ State desync detected! Expected isMyTurn:', expectedIsMyTurn, 'Actual:', isMyTurn);
                console.warn('Current state:', {
                    currentPlayerIndex: state.currentPlayerIndex,
                    currentPlayerColor: currentPlayer?.color,
                    myColor: multiplayerConfig.localPlayerColor,
                    turnState: state.turnState
                });
                // Request state sync from server
                socketService.requestStateSync(multiplayerConfig.gameId);
            }
        }, 10000); // Check every 10 seconds

        return () => clearInterval(syncInterval);
    }, [isMultiplayer, state.gameStarted, state.currentPlayerIndex, state.players, state.turnState, isMyTurn, multiplayerConfig?.localPlayerColor, multiplayerConfig?.gameId]);

    return { state, startGame, handleRollDice, handleMoveToken, handleAnimationComplete, setState, isMyTurn };
};
