import React, { useState, useEffect } from 'react';
import { X, Phone, Calendar, Clock, CheckCircle } from 'lucide-react';

export type ScheduleType = 'CALL' | 'MEETING' | 'TASK';

interface ScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: ScheduleData) => void;
    contactName?: string;
    initialType?: ScheduleType;
    initialTitle?: string;
    initialDescription?: string;
    initialDate?: string; // YYYY-MM-DD
    initialTime?: string; // HH:mm
}

export interface ScheduleData {
    type: ScheduleType;
    title: string;
    description: string;
    date: string;
    time: string;
}

const typeConfig = {
    CALL: { label: 'Ligação', icon: Phone, color: 'blue' },
    MEETING: { label: 'Reunião', icon: Calendar, color: 'purple' },
    TASK: { label: 'Tarefa', icon: Clock, color: 'orange' },
};

/**
 * Componente React `ScheduleModal`.
 *
 * @param {ScheduleModalProps} {
    isOpen,
    onClose,
    onSave,
    contactName = 'Contato',
    initialType = 'CALL',
    initialTitle,
    initialDescription,
    initialDate,
    initialTime,
} - Parâmetro `{
    isOpen,
    onClose,
    onSave,
    contactName = 'Contato',
    initialType = 'CALL',
    initialTitle,
    initialDescription,
    initialDate,
    initialTime,
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export function ScheduleModal({
    isOpen,
    onClose,
    onSave,
    contactName = 'Contato',
    initialType = 'CALL',
    initialTitle,
    initialDescription,
    initialDate,
    initialTime,
}: ScheduleModalProps) {
    const [type, setType] = useState<ScheduleType>(initialType);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('10:00');
    const [isSaving, setIsSaving] = useState(false);
    const [titleTouched, setTitleTouched] = useState(false);

    // Reset form when modal opens
    useEffect(() => {
        if (!isOpen) return;

        setTitleTouched(false);
        setType(initialType);

        const defaultTitle = typeConfig[initialType].label + ' com ' + contactName;
        setTitle(typeof initialTitle === 'string' && initialTitle.trim() ? initialTitle : defaultTitle);

        setDescription(typeof initialDescription === 'string' ? initialDescription : '');

        // Default to tomorrow (unless provided)
        if (typeof initialDate === 'string' && initialDate) {
            setDate(initialDate);
        } else {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            setDate(tomorrow.toISOString().split('T')[0]);
        }

        setTime(typeof initialTime === 'string' && initialTime ? initialTime : '10:00');
    }, [isOpen, initialType, contactName, initialTitle, initialDescription, initialDate, initialTime]);

    // Update title when type changes
    useEffect(() => {
        if (!isOpen) return;
        if (titleTouched) return;
        // Se abriu com um título sugerido (ex.: IA) e ainda está no tipo inicial, não sobrescrever.
        if (typeof initialTitle === 'string' && initialTitle.trim() && type === initialType) return;

        setTitle(typeConfig[type].label + ' com ' + contactName);
    }, [isOpen, type, contactName, titleTouched, initialTitle, initialType]);

    const handleSave = async () => {
        if (!title.trim() || !date) return;

        setIsSaving(true);
        try {
            await onSave({
                type,
                title: title.trim(),
                description: description.trim(),
                date,
                time,
            });
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const config = typeConfig[type];

    return (
        <div className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-slate-900 border border-slate-700 rounded-xl w-full max-w-xl mx-4 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Calendar size={20} className="text-brand-400" />
                        Agendar Atividade
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4 overflow-y-auto">
                    {/* Type selector */}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-2">Tipo</label>
                        <div className="grid grid-cols-3 gap-2">
                            {(Object.keys(typeConfig) as ScheduleType[]).map((t) => {
                                const cfg = typeConfig[t];
                                const Icon = cfg.icon;
                                const isSelected = type === t;
                                return (
                                    <button
                                        key={t}
                                        onClick={() => setType(t)}
                                        className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-all ${isSelected
                                                ? `border-${cfg.color}-500 bg-${cfg.color}-500/10 text-${cfg.color}-400`
                                                : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
                                            }`}
                                        style={isSelected ? {
                                            borderColor: cfg.color === 'blue' ? '#3b82f6' : cfg.color === 'purple' ? '#a855f7' : '#f97316',
                                            backgroundColor: cfg.color === 'blue' ? 'rgba(59,130,246,0.1)' : cfg.color === 'purple' ? 'rgba(168,85,247,0.1)' : 'rgba(249,115,22,0.1)',
                                            color: cfg.color === 'blue' ? '#60a5fa' : cfg.color === 'purple' ? '#c084fc' : '#fb923c',
                                        } : {}}
                                    >
                                        <Icon size={18} />
                                        <span className="text-xs font-medium">{cfg.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Title */}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-2">Título</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => {
                                setTitleTouched(true);
                                setTitle(e.target.value);
                            }}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
                            placeholder="Ex: Ligar para João"
                        />
                    </div>

                    {/* Date and Time */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-2">Data</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-2">Horário</label>
                            <input
                                type="time"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                            />
                        </div>
                    </div>

                    {/* Quick time buttons */}
                    <div className="flex gap-2 flex-wrap">
                        {['Hoje', 'Amanhã', 'Próx. semana'].map((label, idx) => {
                            const d = new Date();
                            if (idx === 1) d.setDate(d.getDate() + 1);
                            if (idx === 2) d.setDate(d.getDate() + 7);
                            const dateStr = d.toISOString().split('T')[0];
                            return (
                                <button
                                    key={label}
                                    onClick={() => setDate(dateStr)}
                                    className={`px-3 py-1 text-xs rounded-full transition-colors ${date === dateStr
                                            ? 'bg-brand-500 text-white'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-2">Descrição (opcional)</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={4}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-500 resize-y min-h-[120px] max-h-[40vh]"
                            placeholder="Notas adicionais..."
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-4 border-t border-slate-800 shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!title.trim() || !date || isSaving}
                        className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        {isSaving ? (
                            <span className="animate-spin">⏳</span>
                        ) : (
                            <CheckCircle size={16} />
                        )}
                        Agendar
                    </button>
                </div>
            </div>
        </div>
    );
}
