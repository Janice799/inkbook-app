// InkBook — Dashboard Logic

document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('pageTitle');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');

    // Title map
    const titles = {
        overview: 'Overview',
        bookings: 'Bookings',
        gallery: 'Flash Gallery',
        clients: 'Clients',
        earnings: 'Earnings',
        settings: 'Settings'
    };

    // Tab switching
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            tabContents.forEach(t => t.classList.remove('active'));
            document.getElementById(`tab-${tab}`).classList.add('active');

            pageTitle.textContent = titles[tab] || tab;

            // Close sidebar on mobile
            sidebar.classList.remove('open');
        });
    });

    // Sidebar toggle (mobile)
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Copy booking link
    const copyBtn = document.getElementById('copyLink');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText('book.inkbook.io/inkmaster_kai').then(() => {
                copyBtn.textContent = '✅';
                setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
            });
        });
    }

    // Filter buttons toggling
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Animate stat cards on load
    document.querySelectorAll('.stat-card').forEach((card, i) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 + i * 80);
    });

    console.log('⚡ InkBook Dashboard loaded');
});
