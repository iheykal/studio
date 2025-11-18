import React, { useState, useEffect } from 'react';
import type { PlayerColor } from '../types';
import { PLAYER_TAILWIND_COLORS } from '../lib/boardLayout';
import { audioService } from '../services/audioService';

interface DiceProps {
  value: number | null;
  onRoll: () => void;
  isMyTurn: boolean;
  playerColor?: PlayerColor;
}

const DiceFace: React.FC<{ value: number; textColor?: string }> = ({ value, textColor = '#ffffff' }) => {
    return (
        <span className="dice-number" style={{ color: textColor }}>{value}</span>
    );
};

const Dice: React.FC<DiceProps> = ({ value, onRoll, isMyTurn, playerColor = 'red' }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [cubeClass, setCubeClass] = useState('show-1');
  
  const colorConfig = PLAYER_TAILWIND_COLORS[playerColor];
  // Convert hex to rgba for drop-shadow filter
  const hexToRgba = (hex: string, alpha: number = 0.7) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  const glowColor = hexToRgba(colorConfig.hex);
  // Use white text for all colors except yellow, which needs dark text
  const textColor = playerColor === 'yellow' ? '#1e293b' : '#ffffff';

  useEffect(() => {
    console.log('🎲 Dice component - isMyTurn changed:', isMyTurn);
  }, [isMyTurn]);

  useEffect(() => {
    if (value !== null) {
      setIsAnimating(true);
      // Play dice roll sound after a small delay to ensure user interaction is registered
      const soundTimer = setTimeout(() => {
        audioService.play('diceRoll');
      }, 100);
      // The final state is set after the animation
      const timer = setTimeout(() => {
        setCubeClass(`show-${value}`);
        setIsAnimating(false);
      }, 1000); // must match animation duration in index.html
      
      return () => {
        clearTimeout(timer);
        clearTimeout(soundTimer);
      };
    }
  }, [value]);

  const handleClick = () => {
    console.log('🎲 Dice clicked, isMyTurn:', isMyTurn);
    if (isMyTurn) {
        // Play click sound first to unlock audio if needed
        audioService.play('click');
        onRoll();
    } else {
        console.log('❌ Cannot roll - not my turn');
    }
  }

  const clickableClass = isMyTurn ? 'dice-clickable' : '';
  const diceStyle = {
    '--dice-bg-color': colorConfig.hex,
    '--dice-border-color': colorConfig.hex,
    '--dice-glow-color': glowColor,
  } as React.CSSProperties;

  return (
    <div className="flex flex-col items-center space-y-2">
        <div 
            className={`scene ${clickableClass}`}
            onClick={handleClick}
            role="button"
            aria-label="Roll dice"
            aria-disabled={!isMyTurn}
            style={diceStyle}
        >
            <div className={`cube ${isAnimating ? 'is-rolling' : ''} ${!isAnimating ? cubeClass : ''}`}>
                <div className="face face-1" style={{ background: colorConfig.hex, borderColor: colorConfig.hex }}><DiceFace value={1} textColor={textColor} /></div>
                <div className="face face-2" style={{ background: colorConfig.hex, borderColor: colorConfig.hex }}><DiceFace value={2} textColor={textColor} /></div>
                <div className="face face-3" style={{ background: colorConfig.hex, borderColor: colorConfig.hex }}><DiceFace value={3} textColor={textColor} /></div>
                <div className="face face-4" style={{ background: colorConfig.hex, borderColor: colorConfig.hex }}><DiceFace value={4} textColor={textColor} /></div>
                <div className="face face-5" style={{ background: colorConfig.hex, borderColor: colorConfig.hex }}><DiceFace value={5} textColor={textColor} /></div>
                <div className="face face-6" style={{ background: colorConfig.hex, borderColor: colorConfig.hex }}><DiceFace value={6} textColor={textColor} /></div>
            </div>
        </div>
      <p className="text-slate-400 text-center h-8 flex items-center justify-center font-semibold">
          {isMyTurn ? 'Click the dice to roll' : ''}
      </p>
    </div>
  );
};

export default Dice;
