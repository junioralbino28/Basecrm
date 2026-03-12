import React, { useEffect } from 'react';
import { useBoardsController } from './hooks/useBoardsController';
import { PipelineView } from './components/PipelineView';
import { OnboardingModal } from '@/components/OnboardingModal';
import { useFirstVisit } from '@/hooks/useFirstVisit';

/**
 * Componente React `BoardsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardsPage: React.FC = () => {
    const controller = useBoardsController();
    const { isFirstVisit, completeOnboarding } = useFirstVisit();
    const [showOnboarding, setShowOnboarding] = React.useState(false);

    // Show onboarding modal on first visit IF there are no boards
    // Only decide after boards have been fetched at least once
    useEffect(() => {
        // Wait until boards query has completed at least once
        if (!controller.boardsFetched) return;

        if (isFirstVisit && controller.boards.length === 0) {
            const timer = setTimeout(() => {
                setShowOnboarding(true);
            }, 500);
            return () => clearTimeout(timer);
        } else if (isFirstVisit && controller.boards.length > 0) {
            // If first visit but has boards, mark as completed silently
            completeOnboarding();
        }
    }, [isFirstVisit, controller.boards.length, controller.boardsFetched, completeOnboarding]);

    const handleOnboardingStart = () => {
        setShowOnboarding(false);
        completeOnboarding();
        // Open wizard automatically
        controller.setIsWizardOpen(true);
    };

    const handleOnboardingSkip = () => {
        setShowOnboarding(false);
        completeOnboarding();
    };

    if (controller.boardsErrorMessage) {
        return (
            <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-6">
                <div className="w-full rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
                    <h2 className="text-xl font-semibold text-white">Falha ao abrir Funis</h2>
                    <p className="mt-2 text-sm text-rose-100/90">{controller.boardsErrorMessage}</p>
                    <p className="mt-3 text-xs text-slate-300">
                        O sistema saiu do carregamento infinito para permitir diagnostico e navegacao.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <>
            <PipelineView {...controller} />

            <OnboardingModal
                isOpen={showOnboarding}
                onStart={handleOnboardingStart}
                onSkip={handleOnboardingSkip}
            />
        </>
    );
};

// @deprecated - Use BoardsPage
export const PipelinePage = BoardsPage;
