
export const getRoleFromMetadata = (user) => {
    if (!user) return null;


    const rawRole = (
        user.app_metadata?.role ||
        user.user_metadata?.role ||
        user.role
    );

    if (!rawRole) return null;

    const role = String(rawRole).toLowerCase().trim();


    if (role.includes('director') || role.includes('reditel') || role.includes('ředitel')) {
        return 'director';
    }


    const hMatch = role.match(/h([1-3])/);
    if (hMatch) {
        return `evaluator-${hMatch[1]}`;
    }

    const eMatch = role.match(/evaluator[- ]?([1-3])/);
    if (eMatch) {
        return `evaluator-${eMatch[1]}`;
    }

    const czMatch = role.match(/hodnotitel[- ]?([1-3])/);
    if (czMatch) {
        return `evaluator-${czMatch[1]}`;
    }


    if (['evaluator-1', 'evaluator-2', 'evaluator-3', 'director'].includes(role)) {
        return role;
    }

    return null;
};
