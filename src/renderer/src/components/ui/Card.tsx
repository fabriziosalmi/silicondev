import React from 'react';

export function Card({
    children,
    className = ""
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`bg-elevated/70 border border-outline rounded-xl p-6 ${className}`}>
            {children}
        </div>
    );
}
